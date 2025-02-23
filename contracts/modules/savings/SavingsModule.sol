pragma solidity ^0.5.12;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/roles/CapperRole.sol";
import "../../interfaces/defi/IDefiProtocol.sol";
import "../../common/Module.sol";
import "../access/AccessChecker.sol";
import "../token/PoolToken.sol";
import "./RewardDistributions.sol";

contract SavingsModule is Module, AccessChecker, RewardDistributions, CapperRole {
    uint256 constant MAX_UINT256 = uint256(-1);
    uint256 public constant DISTRIBUTION_AGGREGATION_PERIOD = 24*60*60;

    event ProtocolRegistered(address protocol, address poolToken);
    event YieldDistribution(address indexed poolToken, uint256 amount);
    event DepositToken(address indexed protocol, address indexed token, uint256 dnAmount);
    event Deposit(address indexed protocol, address indexed user, uint256 nAmount, uint256 nFee);
    event WithdrawToken(address indexed protocol, address indexed token, uint256 dnAmount);
    event Withdraw(address indexed protocol, address indexed user, uint256 nAmount, uint256 nFee);
    event UserCapEnabledChange(bool enabled);
    event UserCapChanged(address indexed protocol, address indexed user, uint256 newCap);

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct ProtocolInfo {
        PoolToken poolToken;
        uint256 previousBalance;
        uint256 lastRewardDistribution;
        address[] supportedRewardTokens;
        mapping(address => uint256) userCap; //Limit of pool tokens which can be minted for a user during deposit
    }

    struct TokenData {
        uint8 decimals;
    }

    address[] registeredTokens;
    IDefiProtocol[] registeredProtocols;
    address[] registeredRewardTokens;
    mapping(address => TokenData) tokens;
    mapping(address => ProtocolInfo) protocols; //Mapping of protocol to data we need to calculate APY and do distributions
    mapping(address => address) poolTokenToProtocol;    //Mapping of pool tokens to protocols
    mapping(address => bool) private rewardTokenRegistered;     //marks registered reward tokens
    bool public userCapEnabled;


    function initialize(address _pool) public initializer {
        Module.initialize(_pool);
        CapperRole.initialize(_msgSender());
    }

    function setUserCapEnabled(bool _userCapEnabled) public onlyCapper {
        userCapEnabled = _userCapEnabled;
        emit UserCapEnabledChange(userCapEnabled);
    }

    function setUserCap(address _protocol, address user, uint256 cap) public onlyCapper {
        protocols[_protocol].userCap[user] = cap;
        emit UserCapChanged(_protocol, user, cap);
    }

    function setUserCap(address _protocol, address[] calldata users, uint256[] calldata caps) external onlyCapper {
        require(users.length == caps.length, "SavingsModule: arrays length not match");
        for(uint256 i=0;  i < users.length; i++) {
            protocols[_protocol].userCap[users[i]] = caps[i];
            emit UserCapChanged(_protocol, users[i], caps[i]);
        }
    }

    function registerProtocol(IDefiProtocol protocol, PoolToken poolToken) public onlyOwner {
        uint256 i;
        for (i = 0; i < registeredProtocols.length; i++){
            if (address(registeredProtocols[i]) == address(protocol)) revert("SavingsModule: protocol already registered");
        }
        registeredProtocols.push(protocol);
        protocols[address(protocol)] = ProtocolInfo({
            poolToken: poolToken,
            previousBalance: protocol.normalizedBalance(),
            lastRewardDistribution: 0,
            supportedRewardTokens: protocol.supportedRewardTokens()
        });
        for(i=0; i < protocols[address(protocol)].supportedRewardTokens.length; i++) {
            address rtkn = protocols[address(protocol)].supportedRewardTokens[i];
            if(!rewardTokenRegistered[rtkn]){
                rewardTokenRegistered[rtkn] = true;
                registeredRewardTokens.push(rtkn);
            }
        }
        poolTokenToProtocol[address(poolToken)] = address(protocol);
        address[] memory supportedTokens = protocol.supportedTokens();
        for (i = 0; i < supportedTokens.length; i++) {
            address tkn = supportedTokens[i];
            if (!isTokenRegistered(tkn)){
                registeredTokens.push(tkn);
                tokens[tkn].decimals = ERC20Detailed(tkn).decimals();
            }
        }
        uint256 normalizedBalance= protocols[address(protocol)].previousBalance;
        if(normalizedBalance > 0) {
            uint256 ts = poolToken.totalSupply();
            if(ts < normalizedBalance) {
                poolToken.mint(_msgSender(), normalizedBalance.sub(ts));
            }
        }
        emit ProtocolRegistered(address(protocol), address(poolToken));
    }

    /**
     * @notice Deposit tokens to several protocols
     * @param _protocols Array of protocols to deposit tokens (each protocol only once)
     * @param _tokens Array of tokens to deposit
     * @param _dnAmounts Array of amounts (denormalized to token decimals)
     */
    function deposit(address[] memory _protocols, address[] memory _tokens, uint256[] memory _dnAmounts) 
    public operationAllowed(IAccessModule.Operation.Deposit) 
    returns(uint256[] memory) 
    {
        require(_protocols.length == _tokens.length && _tokens.length == _dnAmounts.length, "SavingsModule: size of arrays does not match");
        uint256[] memory ptAmounts = new uint256[](_protocols.length);
        for (uint256 i=0; i < _protocols.length; i++) {
            address[] memory tkns = new address[](1);
            tkns[0] = _tokens[i];
            uint256[] memory amnts = new uint256[](1);
            amnts[0] = _dnAmounts[i];
            ptAmounts[i] = deposit(_protocols[i], tkns, amnts);
        }
        return ptAmounts;
    }

    /**
     * @notice Deposit tokens to a protocol
     * @param _protocol Protocol to deposit tokens
     * @param _tokens Array of tokens to deposit
     * @param _dnAmounts Array of amounts (denormalized to token decimals)
     */
    function deposit(address _protocol, address[] memory _tokens, uint256[] memory _dnAmounts)
    public operationAllowed(IAccessModule.Operation.Deposit)
    returns(uint256) 
    {
        //distributeRewardIfRequired(_protocol);

        uint256 nBalanceBefore = distributeYieldInternal(_protocol);
        depositToProtocol(_msgSender(), _protocol, _tokens, _dnAmounts);
        uint256 nBalanceAfter = updateProtocolBalance(_protocol);

        PoolToken poolToken = PoolToken(protocols[_protocol].poolToken);
        uint256 nDeposit = nBalanceAfter.sub(nBalanceBefore);
        poolToken.mint(_msgSender(), nDeposit);

        if(userCapEnabled){
            uint256 cap = protocols[_protocol].userCap[_msgSender()];
            require(cap >= nDeposit, "SavingsModule: deposit exeeds cap");
            cap = cap - nDeposit;
            protocols[_protocol].userCap[_msgSender()] = cap;
            emit UserCapChanged(_protocol, _msgSender(), cap);
        }

        uint256 nAmount;
        for (uint256 i=0; i < _tokens.length; i++) {
            nAmount = nAmount.add(normalizeTokenAmount(_tokens[i], _dnAmounts[i]));
        }
        uint256 fee = (nAmount > nDeposit)?nAmount.sub(nDeposit):0;
        emit Deposit(_protocol, _msgSender(), nAmount, fee);
        return nDeposit;
    }

    function depositToProtocol(address beneficiary, address _protocol, address[] memory _tokens, uint256[] memory _dnAmounts) internal {
        require(_tokens.length == _dnAmounts.length, "SavingsModule: count of tokens does not match count of amounts");
        for (uint256 i=0; i < _tokens.length; i++) {
            address tkn = _tokens[i];
            IERC20(tkn).safeTransferFrom(_msgSender(), _protocol, _dnAmounts[i]);
            IDefiProtocol(_protocol).handleDeposit(beneficiary, tkn, _dnAmounts[i]);
            emit DepositToken(_protocol, tkn, _dnAmounts[i]);
        }
    }

    /**
     * Withdraw tokens from protocol (all underlying tokens proportiaonally)
     * @param _protocol Protocol to withdraw from
     * @param nAmount Normalized (to 18 decimals) amount to withdraw
     * @return Amount of PoolToken burned from user
     */
    function withdrawAll(address _protocol, uint256 nAmount)
    public operationAllowed(IAccessModule.Operation.Withdraw)
    returns(uint256) 
    {
        //distributeRewardIfRequired(_protocol);

        PoolToken poolToken = PoolToken(protocols[_protocol].poolToken);

        uint256 nBalanceBefore = distributeYieldInternal(_protocol);
        withdrawFromProtocolProportionally(_msgSender(), IDefiProtocol(_protocol), nAmount, nBalanceBefore);
        uint256 nBalanceAfter = updateProtocolBalance(_protocol);

        uint256 actualAmount = nBalanceBefore.sub(nBalanceAfter);
        require(actualAmount <= nAmount, "SavingsModule: unexpected withdrawal fee");

        if(userCapEnabled){
            uint256 cap = protocols[_protocol].userCap[_msgSender()];
            cap = cap.add(actualAmount);
            protocols[_protocol].userCap[_msgSender()] = cap;
            emit UserCapChanged(_protocol, _msgSender(), cap);
        }

        poolToken.burnFrom(_msgSender(), actualAmount);
        emit Withdraw(_protocol, _msgSender(), actualAmount, 0);
        return actualAmount;
    }

    /**
     * Withdraw token from protocol
     * @param _protocol Protocol to withdraw from
     * @param token Token to withdraw
     * @param dnAmount Amount to withdraw (denormalized)
     * @param maxNAmount Max amount of PoolToken to burn
     * @return Amount of PoolToken burned from user
     */
    function withdraw(address _protocol, address token, uint256 dnAmount, uint256 maxNAmount)
    public operationAllowed(IAccessModule.Operation.Withdraw)
    returns(uint256){
        //distributeRewardIfRequired(_protocol);

        uint256 nBalanceBefore = distributeYieldInternal(_protocol);
        withdrawFromProtocolOne(_msgSender(), IDefiProtocol(_protocol), token, dnAmount);
        uint256 nBalanceAfter = updateProtocolBalance(_protocol);

        uint256 nAmount = nBalanceBefore.sub(nBalanceAfter);
        require(maxNAmount == 0 || nAmount <= maxNAmount, "SavingsModule: provided maxNAmount is too high");
        PoolToken poolToken = PoolToken(protocols[_protocol].poolToken);
        poolToken.burnFrom(_msgSender(), nAmount);

        if(userCapEnabled){
            uint256 cap = protocols[_protocol].userCap[_msgSender()];
            cap = cap.add(nAmount);
            protocols[_protocol].userCap[_msgSender()] = cap;
            emit UserCapChanged(_protocol, _msgSender(), cap);
        }

        uint256 nAmountWithoutFee = normalizeTokenAmount(token, dnAmount);
        uint256 fee = (nAmount > nAmountWithoutFee)?(nAmount-nAmountWithoutFee):0;
        emit WithdrawToken(_protocol, token, dnAmount);
        emit Withdraw(_protocol, _msgSender(), nAmount, fee);
        return nAmount;
    }

    /** 
     * @notice Distributes yield. May be called by bot, if there was no deposits/withdrawals
     */
    function distributeYield() public {
        for(uint256 i=0; i<registeredProtocols.length; i++) {
            distributeYieldInternal(address(registeredProtocols[i]));
        }
    }

    /** 
     * @notice Distributes reward tokens. May be called by bot, if there was no deposits/withdrawals
     */
    function distributeRewards() public {
        for(uint256 i=0; i<registeredProtocols.length; i++) {
            distributeRewardIfRequired(address(registeredProtocols[i]));
        }
    }

    function distributeRewards(address _protocol) public {
        distributeRewardIfRequired(_protocol);
    }

    function userCap(address _protocol, address user) public view returns(uint256) {
        return protocols[_protocol].userCap[user];
    }

    function poolTokenByProtocol(address _protocol) public view returns(address) {
        return address(protocols[_protocol].poolToken);
    }

    function protocolByPoolToken(address _protocol) public view returns(address) {
        return poolTokenToProtocol[_protocol];
    }

    function rewardTokensByProtocol(address _protocol) public view returns(address[] memory) {
        return protocols[_protocol].supportedRewardTokens;
    }

    function registeredPoolTokens() public view returns(address[] memory poolTokens) {
        poolTokens = new address[](registeredProtocols.length);
        for(uint256 i=0; i<poolTokens.length; i++){
            poolTokens[i] = address(protocols[address(registeredProtocols[i])].poolToken);
        }
    }

    function supportedRewardTokens() public view returns(address[] memory) {
        return registeredRewardTokens;
    }

    function withdrawFromProtocolProportionally(address beneficiary, IDefiProtocol protocol, uint256 nAmount, uint256 currentProtocolBalance) internal {
        uint256[] memory balances = protocol.balanceOfAll();
        uint256[] memory amounts = new uint256[](balances.length);
        address[] memory _tokens = protocol.supportedTokens();
        for (uint256 i = 0; i < amounts.length; i++) {
            amounts[i] = balances[i].mul(nAmount).div(currentProtocolBalance);
            emit WithdrawToken(address(protocol), _tokens[i], amounts[i]);
        }
        protocol.withdraw(beneficiary, amounts);
    }

    function withdrawFromProtocolOne(address beneficiary, IDefiProtocol protocol, address token, uint256 dnAmount) internal {
        protocol.withdraw(beneficiary, token, dnAmount);
    }

    /**
     * @notice Calculates difference from previous action with a protocol and distributes yield
     * @dev MUST call this BEFORE deposit/withdraw from protocol
     * @param _protocol to check
     * @return Current balance of the protocol
     */
    function distributeYieldInternal(address _protocol) internal returns(uint256){
        uint256 currentBalance = IDefiProtocol(_protocol).normalizedBalance();
        ProtocolInfo storage pi = protocols[_protocol];
        PoolToken poolToken = PoolToken(pi.poolToken);
        if(currentBalance > pi.previousBalance) {
            uint256 yield = currentBalance.sub(pi.previousBalance);
            pi.previousBalance = currentBalance;
            poolToken.distribute(yield);
            emit YieldDistribution(address(poolToken), yield);
        }
        return currentBalance;
    }

    function distributeRewardIfRequired(address _protocol) internal {
        if(!isRewardDistributionRequired(_protocol)) return;
        ProtocolInfo storage pi = protocols[_protocol];
        pi.lastRewardDistribution = now;
        distributeReward(_protocol);
    }

    /**
     * @notice Updates balance with result of deposit/withdraw
     * @dev MUST call this AFTER deposit/withdraw from protocol
     * @param _protocol to update
     * @return Current balance of the protocol
     */
    function updateProtocolBalance(address _protocol) internal returns(uint256){
        uint256 currentBalance = IDefiProtocol(_protocol).normalizedBalance();
        protocols[_protocol].previousBalance = currentBalance;
        return currentBalance;
    }

    function isTokenRegistered(address token) private view returns(bool) {
        for (uint256 i = 0; i < registeredTokens.length; i++){
            if (registeredTokens[i] == token) return true;
        }
        return false;
    }

    function isPoolToken(address token) internal view returns(bool) {
        for (uint256 i = 0; i < registeredProtocols.length; i++){
            IDefiProtocol protocol = registeredProtocols[i];
            if (address(protocols[address(protocol)].poolToken) == token) return true;
        }
        return false;
    }

    function isRewardDistributionRequired(address _protocol) internal view returns(bool) {
        return now.sub(protocols[_protocol].lastRewardDistribution) > DISTRIBUTION_AGGREGATION_PERIOD;
    }

    function normalizeTokenAmount(address token, uint256 amount) private view returns(uint256) {
        uint256 decimals = tokens[token].decimals;
        if (decimals == 18) {
            return amount;
        } else if (decimals > 18) {
            return amount.div(10**(decimals-18));
        } else if (decimals < 18) {
            return amount.mul(10**(18 - decimals));
        }
    }

    function denormalizeTokenAmount(address token, uint256 amount) private view returns(uint256) {
        uint256 decimals = tokens[token].decimals;
        if (decimals == 18) {
            return amount;
        } else if (decimals > 18) {
            return amount.mul(10**(decimals-18));
        } else if (decimals < 18) {
            return amount.div(10**(18 - decimals));
        }
    }

}
