pragma solidity ^0.5.12;

import "./CurveFiProtocol.sol";
import "../../interfaces/defi/ICurveFiDeposit_SBTC.sol";
import "../../interfaces/defi/ICurveFiRewards_SBTC.sol";

contract CurveFiProtocol_SBTC is CurveFiProtocol {
    uint256 private constant N_COINS = 3;

    address balRewardToken;

    function nCoins() internal returns(uint256) {
        return N_COINS;
    }

    function setBalRewardToken(address _balRewardToken) public onlyDefiOperator {
        balRewardToken = _balRewardToken;
    }

    function supportedRewardTokens() public view returns(address[] memory) {
        require(balRewardToken != address(0), "CurveFiProtocol_SBTC: not yet fully initialized");
        address[] memory rtokens = new address[](2);
        rtokens[0] = address(curveFiRewardToken);
        rtokens[1] = balRewardToken;
        return rtokens;
    }

    function isSupportedRewardToken(address token) public view returns(bool) {
        return(
            (token == address(curveFiRewardToken)) ||
            (token == balRewardToken)
        );
    }

    // Nothing needed to claim BAL, so original implementaion will work
    // function cliamRewardsFromProtocol() internal {
    //     curveFiRewards.getReward();
    // }

    function reward_rewardToken(address rewardsController) internal returns(address){
        return ICurveFiRewards_SBTC(rewardsController).rewardsToken();
    }

    function convertArray(uint256[] memory amounts) internal pure returns(uint256[N_COINS] memory) {
        require(amounts.length == N_COINS, "CurveFiProtocol_SBTC: wrong token count");
        uint256[N_COINS] memory amnts = [uint256(0), uint256(0), uint256(0)];
        for(uint256 i=0; i < N_COINS; i++){
            amnts[i] = amounts[i];
        }
        return amnts;
    }

    function deposit_add_liquidity(uint256[] memory amounts, uint256 min_mint_amount) internal {
        ICurveFiDeposit_SBTC(address(curveFiDeposit)).add_liquidity(convertArray(amounts), min_mint_amount);
    }

    function deposit_remove_liquidity_imbalance(uint256[] memory amounts, uint256 max_burn_amount) internal {
        ICurveFiDeposit_SBTC(address(curveFiDeposit)).remove_liquidity_imbalance(convertArray(amounts), max_burn_amount);
    }

}
