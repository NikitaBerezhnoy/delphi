import {
    VaultProtocolStubContract, VaultProtocolStubInstance,
    TestErc20Contract, TestErc20Instance
} from "../../../types/truffle-contracts/index";

// tslint:disable-next-line:no-var-requires
const { BN, constants, expectEvent, shouldFail, time } = require("@openzeppelin/test-helpers");
// tslint:disable-next-line:no-var-requires
import Snapshot from "../../utils/snapshot";
const { expect, should } = require('chai');

const expectRevert= require("../../utils/expectRevert");
const expectEqualBN = require("../../utils/expectEqualBN");
const w3random = require("../../utils/w3random");

const ERC20 = artifacts.require("TestERC20");

const VaultProtocol = artifacts.require("VaultProtocolStub");

contract("VaultProtocol", async ([_, owner, user1, user2, user3, pool, defiops, protocolStub, ...otherAccounts]) => {
    let globalSnap: Snapshot;
    let vaultProtocol: VaultProtocolStubInstance;
    let dai: TestErc20Instance;
    let usdc: TestErc20Instance;
    let busd: TestErc20Instance;


    before(async () => {
        vaultProtocol = await VaultProtocol.new({from:owner});
        await (<any> vaultProtocol).methods['initialize(address)'](pool, {from: owner});
        await vaultProtocol.addDefiOperator(defiops, {from:owner});

        //Deposit token 1
        dai = await ERC20.new({from:owner});
        await dai.initialize("DAI", "DAI", 18, {from:owner})
        //Deposit token 2
        usdc = await ERC20.new({from:owner});
        await usdc.initialize("USDC", "USDC", 18, {from:owner})
        //Deposit token 3
        busd = await ERC20.new({from:owner});
        await busd.initialize("BUSD", "BUSD", 18, {from:owner})

        await dai.transfer(user1, 1000, {from:owner});
        await dai.transfer(user2, 1000, {from:owner});
        await dai.transfer(user3, 1000, {from:owner});

        await usdc.transfer(user1, 1000, {from:owner});
        await usdc.transfer(user2, 1000, {from:owner});
        await usdc.transfer(user3, 1000, {from:owner});

        await busd.transfer(user1, 1000, {from:owner});
        await busd.transfer(user2, 1000, {from:owner});
        await busd.transfer(user3, 1000, {from:owner});

        await vaultProtocol.registerTokens([dai.address, usdc.address, busd.address], {from: defiops})
        await vaultProtocol.setProtocol(protocolStub, {from: defiops});

        globalSnap = await Snapshot.create(web3.currentProvider);
    });

    describe('Deposit into the vault', () => {
        afterEach(async () => {
            await globalSnap.revert();
        });
        it('Deposit single token into the vault', async () => {
            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit is not empty").to.equal(0);

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            let depositResult = await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 10, {from:defiops});

            expectEvent(depositResult, 'DepositToVault', {_user: user1, _token: dai.address, _amount: "10"});

            onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit was not set on-hold").to.equal(10);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };
            expect(after.vaultBalance.sub(before.vaultBalance).toNumber(), "Tokens are not transferred to vault").to.equal(10);
            expect(before.userBalance.sub(after.userBalance).toNumber(), "Tokens are not transferred from user").to.equal(10);
        });

        it('Deposit several tokens into the vault (one-by-one)', async () => {
            let before = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 10, {from:defiops});
            await usdc.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, usdc.address, 20, {from:defiops});
            await busd.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, busd.address, 30, {from:defiops});

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit (1) was not added to on-hold").to.equal(10);

            onhold = await vaultProtocol.amountOnHold(user1, usdc.address);
            expect(onhold.toNumber(), "Deposit (2) was not added to on-hold").to.equal(20);

            onhold = await vaultProtocol.amountOnHold(user1, busd.address);
            expect(onhold.toNumber(), "Deposit (3) was not added to on-hold").to.equal(30);

            let after = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };
            expect(after.vaultBalance1.sub(before.vaultBalance1).toNumber(), "Tokens (1) are not transferred to vault").to.equal(10);
            expect(after.vaultBalance2.sub(before.vaultBalance2).toNumber(), "Tokens (2) are not transferred to vault").to.equal(20);
            expect(after.vaultBalance3.sub(before.vaultBalance3).toNumber(), "Tokens (3) are not transferred to vault").to.equal(30);
        });

        it('Deposit several tokens into the vault', async () => {
            let before = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await usdc.approve(vaultProtocol.address, 100, {from:user1});
            await busd.approve(vaultProtocol.address, 100, {from:user1});

            await (<any> vaultProtocol).methods['depositToVault(address,address[],uint256[])'](
                    user1, [dai.address, usdc.address, busd.address], [10,20,30],
                    {from:defiops});

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit (1) was not added to on-hold").to.equal(10);

            onhold = await vaultProtocol.amountOnHold(user1, usdc.address);
            expect(onhold.toNumber(), "Deposit (2) was not added to on-hold").to.equal(20);

            onhold = await vaultProtocol.amountOnHold(user1, busd.address);
            expect(onhold.toNumber(), "Deposit (3) was not added to on-hold").to.equal(30);

            let after = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };
            expect(after.vaultBalance1.sub(before.vaultBalance1).toNumber(), "Tokens (1) are not transferred to vault").to.equal(10);
            expect(after.vaultBalance2.sub(before.vaultBalance2).toNumber(), "Tokens (2) are not transferred to vault").to.equal(20);
            expect(after.vaultBalance3.sub(before.vaultBalance3).toNumber(), "Tokens (3) are not transferred to vault").to.equal(30);
        });

        it('Deposit from several users to the vault', async () => {
            let before = {
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 10, {from:defiops});
            await dai.approve(vaultProtocol.address, 100, {from:user2});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, dai.address, 20, {from:defiops});

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit (1) was not added to on-hold").to.equal(10);

            onhold = await vaultProtocol.amountOnHold(user2, dai.address);
            expect(onhold.toNumber(), "Deposit (2) was not added to on-hold").to.equal(20);

            let after = {
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };
            expect(after.vaultBalance.sub(before.vaultBalance).toNumber(), "Tokens are not transferred to vault").to.equal(30);
        });

        it('Additional deposit', async () => {
            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 10, {from:defiops});
            let depositResult = await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 20, {from:defiops});

            expectEvent(depositResult, 'DepositToVault', {_user: user1, _token: dai.address, _amount: "20"});

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "Deposit was not added to on-hold").to.equal(30);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };
            expect(after.vaultBalance.sub(before.vaultBalance).toNumber(), "Tokens are not transferred to vault").to.equal(30);
            expect(before.userBalance.sub(after.userBalance).toNumber(), "Tokens are not transferred from user").to.equal(30);
        });
    });

    describe('Withdraw token if on-hold tokens exist', () => {
        let snap: Snapshot;
        before(async () => {
            await dai.transfer(vaultProtocol.address, 100, {from:owner});
            await usdc.transfer(vaultProtocol.address, 100, {from:owner});
            await busd.transfer(vaultProtocol.address, 100, {from:owner});

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await usdc.approve(vaultProtocol.address, 100, {from:user1});
            await busd.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address[],uint256[])'](
                user1, [dai.address, usdc.address, busd.address], [100,100,100],
                {from:defiops});

            snap = await Snapshot.create(web3.currentProvider);
        });

        after(async () => {
            await globalSnap.revert();
        });

        afterEach(async () => {
            await snap.revert();
        });

        it('Withdraw tokens from vault (enough liquidity)', async () => {
            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user1, _token: dai.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            //Deposit record is removed from on-hold storage
            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "On-hold deposit was not withdrawn").to.equal(0);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is transfered back to the user
            expect(before.vaultBalance.sub(after.vaultBalance).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(after.userBalance.sub(before.userBalance).toNumber(), "Tokens are not transferred to user").to.equal(100);
        });

        it('Withdraw more tokens than deposited on-hold (enough liquidity)', async () => {
            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 150, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user1, _token: dai.address, _amount: "150"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            //Deposit record is removed from on-hold storage
            let onholdAfter = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onholdAfter.toNumber(), "On-hold deposit was not withdrawn").to.equal(0);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is transfered back to the user
            expect(before.vaultBalance.sub(after.vaultBalance).toNumber(), "Tokens are not transferred from vault").to.equal(150);
            expect(after.userBalance.sub(before.userBalance).toNumber(), "Tokens are not transferred to user").to.equal(150);
        });

        it('Withdraw the part of on-hold tokens (enough liquidity)', async () => {
            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            let onholdBefore = await vaultProtocol.amountOnHold(user1, dai.address);
            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 50, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user1, _token: dai.address, _amount: "50"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            //Deposit record is updated in the on-hold storage
            let onholdAfter = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onholdBefore.sub(onholdAfter).toNumber(), "On-hold deposit was not withdrawn").to.equal(50);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is transfered back to the user
            expect(before.vaultBalance.sub(after.vaultBalance).toNumber(), "Tokens are not transferred from vault").to.equal(50);
            expect(after.userBalance.sub(before.userBalance).toNumber(), "Tokens are not transferred to user").to.equal(50);
        });

        it('Withdraw if no on-hold tokens (enough liquidity)', async () => {
            let before = {
                userBalance: await dai.balanceOf(user2),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, dai.address, 100, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: dai.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            let onhold = await vaultProtocol.amountOnHold(user2, dai.address);
            expect(onhold.toNumber(), "On-hold deposit was not withdrawn").to.equal(0);

            let after = {
                userBalance: await dai.balanceOf(user2),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is transfered to the user
            expect(before.vaultBalance.sub(after.vaultBalance).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(after.userBalance.sub(before.userBalance).toNumber(), "Tokens are not transferred to user").to.equal(100);
        });

        it('Withdraw several tokens (no on-hold tokens)', async () => {
            let before = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address[],uint256[])'](
                user2, [dai.address,usdc.address,busd.address], [100,100,100], {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: dai.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: usdc.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: busd.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            let after = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            //Token is transfered to the user
            expect(before.vaultBalance1.sub(after.vaultBalance1).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(before.vaultBalance2.sub(after.vaultBalance2).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(before.vaultBalance3.sub(after.vaultBalance3).toNumber(), "Tokens are not transferred from vault").to.equal(100);
        });

        it('Withdraw several tokens (one of tokens is on-hold)', async () => {
            await dai.approve(vaultProtocol.address, 50, {from:user2});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, dai.address, 50, {from:defiops});

            let onholdBefore = await vaultProtocol.amountOnHold(user2, dai.address);

            let before = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address[],uint256[])'](
                user2, [dai.address,usdc.address,busd.address], [100,100,100], {from:defiops});

            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: dai.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: usdc.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: busd.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawRequestCreated');

            let onholdAfter = await vaultProtocol.amountOnHold(user2, dai.address);
            expect(onholdBefore.sub(onholdAfter).toNumber(), "On-hold deposit was not withdrawn").to.equal(50);

            let after = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            //Token is transfered to the user
            expect(before.vaultBalance1.sub(after.vaultBalance1).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(before.vaultBalance2.sub(after.vaultBalance2).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(before.vaultBalance3.sub(after.vaultBalance3).toNumber(), "Tokens are not transferred from vault").to.equal(100);
        });
    });

    describe('Create withdraw request', () => {
        let snap: Snapshot;
        before(async () => {
            await dai.transfer(vaultProtocol.address, 100, {from:owner});
            await usdc.transfer(vaultProtocol.address, 100, {from:owner});
            await busd.transfer(vaultProtocol.address, 100, {from:owner});

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await usdc.approve(vaultProtocol.address, 100, {from:user1});
            await busd.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address[],uint256[])'](
                user1, [dai.address, usdc.address, busd.address], [100,100,100],
                {from:defiops});

            snap = await Snapshot.create(web3.currentProvider);
        });

        after(async () => {
            await globalSnap.revert();
        });

        afterEach(async () => {
            await snap.revert();
        });

        it('Withdraw token (no on-hold tokens, not enough liquidity)', async () => {
            //Liquidity is withdrawn by another user
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user3, dai.address, 150, {from:defiops});

            let before = {
                userBalance: await dai.balanceOf(user2),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //User2 tries to withdraw more tokens than are currently on the protocol
            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, dai.address, 100, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawRequestCreated', {_user: user2, _token: dai.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawFromVault');

            let after = {
                userBalance: await dai.balanceOf(user2),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is not transferred to the user
            expect(before.vaultBalance.toString(), "Tokens should not be transferred from protocol").to.equal(after.vaultBalance.toString());
            expect(after.userBalance.toString(), "Tokens should not be transferred to user").to.equal(before.userBalance.toString());

            //User has withdraw request created
            let requestedAmount = await vaultProtocol.amountRequested(user2, dai.address);
            expect(requestedAmount.toNumber(), "Request should be created").to.equal(100);
        });

        it('Withdraw with on-hold token (not enough liquidity)', async () => {
            let onholdBefore = await vaultProtocol.amountOnHold(user1, dai.address);

            //Liquidity is withdrawn by another user
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, dai.address, 150, {from:defiops});

            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //User1 (with on-hold tokens) tries to withdraw more tokens than are currently on the protocol
            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});

            expectEvent(withdrawResult, 'WithdrawRequestCreated', {_user: user1, _token: dai.address, _amount: "100"});
            expectEvent.notEmitted(withdrawResult, 'WithdrawFromVault');

            let onholdAfter = await vaultProtocol.amountOnHold(user1, dai.address);

            expect(onholdAfter.toString(), "On-hold deposit should be left untouched").to.equal(onholdBefore.toString());

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            //Token is not transferred to the user
            expect(before.vaultBalance.toString(), "Tokens should not be transferred from protocol").to.equal(after.vaultBalance.toString());
            expect(after.userBalance.toString(), "Tokens should not be transferred to user").to.equal(before.userBalance.toString());

            //Withdraw request created
            let requestedAmount = await vaultProtocol.amountRequested(user1, dai.address);
            expect(requestedAmount.toNumber(), "Request should be created").to.equal(100);

        });

        it('Withdraw several tokens - not enough liquidity for one of them', async () => {
            //Liquidity is withdrawn by another user
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user3, dai.address, 150, {from:defiops});

            let before = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            let withdrawResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address[],uint256[])'](
                user2, [dai.address,usdc.address,busd.address], [100,100,100], {from:defiops});

            expectEvent(withdrawResult, 'WithdrawRequestCreated', {_user: user2, _token: dai.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: usdc.address, _amount: "100"});
            expectEvent(withdrawResult, 'WithdrawFromVault', {_user: user2, _token: busd.address, _amount: "100"});


            let after = {
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address)
            };

            //1 token is requested, 2 tokens are transfered to the user
            expect(before.vaultBalance1.toString(), "Tokens are not transferred from vault").to.equal(after.vaultBalance1.toString());
            expect(before.vaultBalance2.sub(after.vaultBalance2).toNumber(), "Tokens are not transferred from vault").to.equal(100);
            expect(before.vaultBalance3.sub(after.vaultBalance3).toNumber(), "Tokens are not transferred from vault").to.equal(100);

            //Withdraw request created
            let requestedAmount = await vaultProtocol.amountRequested(user2, dai.address);
            expect(requestedAmount.toNumber(), "Request should be created").to.equal(100);
        });
    });


    describe('Operator resolves withdraw requests', () => {
        let snap: Snapshot;
        before(async () => {
            await dai.approve(vaultProtocol.address, 1000, {from:user1});
            await usdc.approve(vaultProtocol.address, 1000, {from:user1});
            await busd.approve(vaultProtocol.address, 1000, {from:user1});

            await dai.approve(vaultProtocol.address, 1000, {from:user2});
            await usdc.approve(vaultProtocol.address, 1000, {from:user2});
            await busd.approve(vaultProtocol.address, 1000, {from:user2});

            await dai.transfer(protocolStub, 1000, {from: owner});
            await usdc.transfer(protocolStub, 1000, {from: owner});
            await busd.transfer(protocolStub, 1000, {from: owner});

            await dai.approve(vaultProtocol.address, 1000, {from:protocolStub});
            await usdc.approve(vaultProtocol.address, 1000, {from:protocolStub});
            await busd.approve(vaultProtocol.address, 1000, {from:protocolStub});

            snap = await Snapshot.create(web3.currentProvider);
        });

        after(async () => {
            await globalSnap.revert();
        });

        afterEach(async () => {
            await snap.revert();
        });

        it('On-hold funds are sent to the protocol', async () => {
            let before = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, usdc.address, 50, {from:defiops});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, busd.address, 10, {from:defiops});

            // withdraw by operator
            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent(opResult, 'DepositByOperator', {_amount: "160"});

            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "On-hold record (1) should be deleted").to.equal(0);
            onhold = await vaultProtocol.amountOnHold(user1, usdc.address);
            expect(onhold.toNumber(), "On-hold record (2) should be deleted").to.equal(0);
            onhold = await vaultProtocol.amountOnHold(user1, busd.address);
            expect(onhold.toNumber(), "On-hold record (3) should be deleted").to.equal(0);

            let after = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            expect(after.vaultBalance1.toNumber(), "Tokens (1) are not transferred from vault").to.equal(0);
            expect(after.vaultBalance2.toNumber(), "Tokens (2) are not transferred from vault").to.equal(0);
            expect(after.vaultBalance3.toNumber(), "Tokens (3) are not transferred from vault").to.equal(0);

            expect(after.protocolBalance1.sub(before.protocolBalance1).toNumber(), "Protocol didn't receive tokens (1)").to.equal(100);
            expect(after.protocolBalance2.sub(before.protocolBalance2).toNumber(), "Protocol didn't receive tokens (2)").to.equal(50);
            expect(after.protocolBalance3.sub(before.protocolBalance3).toNumber(), "Protocol didn't receive tokens (3)").to.equal(10);
        });

        it('Withdraw request is resolved from current liquidity', async () => {
            let before = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            //Withdraw requests created
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, usdc.address, 50, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, busd.address, 10, {from:defiops});

            //Deposits to create the exact liquidity
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, dai.address, 100, {from:defiops});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, usdc.address, 50, {from:defiops});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, busd.address, 10, {from:defiops});


            // withdraw by operator
            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent.notEmitted(opResult, 'WithdrawByOperator');
            expectEvent(opResult, 'WithdrawReqestsResolved');

            //Withdraw requests are resolved
            let requested = await vaultProtocol.amountRequested(user1, dai.address);
            expect(requested.toNumber(), "Withdraw request (1) should be resolved").to.equal(0);
            requested = await vaultProtocol.amountRequested(user1, usdc.address);
            expect(requested.toNumber(), "Withdraw request (2) should be resolved").to.equal(0);
            requested = await vaultProtocol.amountRequested(user1, busd.address);
            expect(requested.toNumber(), "Withdraw request (3) should be resolved").to.equal(0);

            let after = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            //tokens to claim
            let claimable = await vaultProtocol.claimableAmount(user1, dai.address);
            expect(claimable.toNumber(), "Cannot claim tokens (1)").to.equal(100);
            claimable = await vaultProtocol.claimableAmount(user1, usdc.address);
            expect(claimable.toNumber(), "Cannot claim tokens (2)").to.equal(50);
            claimable = await vaultProtocol.claimableAmount(user1, busd.address);
            expect(claimable.toNumber(), "Cannot claim tokens (3)").to.equal(10);

            expect(after.vaultBalance1.toNumber(), "No new tokens (1) should be transferred to vault").to.equal(100);
            expect(after.vaultBalance2.toNumber(), "No new tokens (2) should be transferred to vault").to.equal(50);
            expect(after.vaultBalance3.toNumber(), "No new tokens (3) should be transferred to vault").to.equal(10);

            expect(before.protocolBalance1.sub(after.protocolBalance1).toNumber(), "Protocol should not send tokens (1)").to.equal(0);
            expect(before.protocolBalance2.sub(after.protocolBalance2).toNumber(), "Protocol should not send tokens (2)").to.equal(0);
            expect(before.protocolBalance3.sub(after.protocolBalance3).toNumber(), "Protocol should not send tokens (3)").to.equal(0);
        });

        it('Withdraw request is resolved with return from protocol', async () => {
            let before = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };
            //Withdraw requests created
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, usdc.address, 50, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, busd.address, 10, {from:defiops});

            // withdraw by operator
            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent.notEmitted(opResult, 'DepositByOperator');
            expectEvent(opResult, 'WithdrawReqestsResolved');
            expectEvent(opResult, 'WithdrawByOperator', {_amount: "160"});

            //Withdraw requests are resolved
            let requested = await vaultProtocol.amountRequested(user1, dai.address);
            expect(requested.toNumber(), "Withdraw request (1) should be resolved").to.equal(0);
            requested = await vaultProtocol.amountRequested(user1, usdc.address);
            expect(requested.toNumber(), "Withdraw request (2) should be resolved").to.equal(0);
            requested = await vaultProtocol.amountRequested(user1, busd.address);
            expect(requested.toNumber(), "Withdraw request (3) should be resolved").to.equal(0);

            let after = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            //tokens to claim
            let claimable = await vaultProtocol.claimableAmount(user1, dai.address);
            expect(claimable.toNumber(), "Cannot claim tokens (1)").to.equal(100);
            claimable = await vaultProtocol.claimableAmount(user1, usdc.address);
            expect(claimable.toNumber(), "Cannot claim tokens (2)").to.equal(50);
            claimable = await vaultProtocol.claimableAmount(user1, busd.address);
            expect(claimable.toNumber(), "Cannot claim tokens (3)").to.equal(10);

            expect(after.vaultBalance1.toNumber(), "Tokens (1) are not transferred to vault").to.equal(100);
            expect(after.vaultBalance2.toNumber(), "Tokens (2) are not transferred to vault").to.equal(50);
            expect(after.vaultBalance3.toNumber(), "Tokens (3) are not transferred to vault").to.equal(10);

            expect(before.protocolBalance1.sub(after.protocolBalance1).toNumber(), "Protocol didn't send tokens (1)").to.equal(100);
            expect(before.protocolBalance2.sub(after.protocolBalance2).toNumber(), "Protocol didn't send tokens (2)").to.equal(50);
            expect(before.protocolBalance3.sub(after.protocolBalance3).toNumber(), "Protocol didn't send tokens (3)").to.equal(10);
        });

        it('Withdraw request is resolved for user with both on-hold and deposited amounts', async () => {
            //In case if there is not enough liquidity to fullfill the request - on-hold amount is left untouched
            //Withdraw should not be fullfilled particulary

            //Create on-hold record
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});

            let before = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address),
                protocolBalance: await dai.balanceOf(protocolStub),
            };

            //Withdraw requests created
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 150, {from:defiops});

            // withdraw by operator
            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent(opResult, 'WithdrawReqestsResolved');
            //On-hold deposit is moved to the protocol
            expectEvent(opResult, 'DepositByOperator', {_amount: "100"});
            //Full amount is withdrawn from the protocol
            expectEvent(opResult, 'WithdrawByOperator', {_amount: "150"});

            //Withdraw request is resolved
            let requested = await vaultProtocol.amountRequested(user1, dai.address);
            expect(requested.toNumber(), "Withdraw request should be resolved").to.equal(0);

            //On-hold record is deleted during the request
            let onhold = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold.toNumber(), "On-hold record should be deleted").to.equal(0);

            //Total amount is marked as claimed
            let claimable = await vaultProtocol.claimableAmount(user1, dai.address);
            expect(claimable.toNumber(), "Cannot claim tokens").to.equal(150);

            let after = {
                userBalance: await dai.balanceOf(user1),
                vaultBalance: await dai.balanceOf(vaultProtocol.address),
                protocolBalance: await dai.balanceOf(protocolStub),
            };

            //Since both deposit and withdraw are fullfilled, only (requested - on-hold) is sent from the protocol
            expect(after.vaultBalance.sub(before.vaultBalance).toNumber(), "Tokens are not transferred to vault").to.equal(50);
            expect(before.protocolBalance.sub(after.protocolBalance).toNumber(), "Protocol didn't send tokens").to.equal(50);
        });
    });

    describe('Claimable tokens functionality', () => {
        let snap: Snapshot;
        before(async () => {
            await dai.approve(vaultProtocol.address, 1000, {from:user1});
            await usdc.approve(vaultProtocol.address, 1000, {from:user1});
            await busd.approve(vaultProtocol.address, 1000, {from:user1});

            await dai.approve(vaultProtocol.address, 1000, {from:user2});
            await usdc.approve(vaultProtocol.address, 1000, {from:user2});
            await busd.approve(vaultProtocol.address, 1000, {from:user2});

            await dai.approve(vaultProtocol.address, 1000, {from:user3});
            await usdc.approve(vaultProtocol.address, 1000, {from:user3});
            await busd.approve(vaultProtocol.address, 1000, {from:user3});

            await dai.transfer(protocolStub, 1000, {from: owner});
            await usdc.transfer(protocolStub, 1000, {from: owner});
            await busd.transfer(protocolStub, 1000, {from: owner});

            await dai.approve(vaultProtocol.address, 1000, {from:protocolStub});
            await usdc.approve(vaultProtocol.address, 1000, {from:protocolStub});
            await busd.approve(vaultProtocol.address, 1000, {from:protocolStub});

            //Create some claimable amounts
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address[],uint256[])'](
                user1, [dai.address, usdc.address, busd.address], [100, 50, 20], {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, dai.address, 80, {from:defiops});
            await vaultProtocol.withdrawOperator({from: defiops});


            snap = await Snapshot.create(web3.currentProvider);
        });

        after(async () => {
            await globalSnap.revert();
        });

        afterEach(async () => {
            await snap.revert();
        });
        it('Deposit from user does not influence claimable amount', async () => {
            let claimableBefore = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 150, {from:defiops});

            let claimableAfter = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            expect(claimableBefore.toString(), "Claimable tokens amount changed").to.equal(claimableAfter.toString());
            expect(claimableTotalBefore.toString(), "Total claimable tokens amount changed").to.equal(claimableTotalAfter.toString());
        });

        it('Withdraw by user (from liquidity on vault) does not influence claimable amount', async () => {
            //Create some liquidity in the vault
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user3, dai.address, 200, {from:defiops});

            let claimableBefore = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            let opResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});
            expectEvent.notEmitted(opResult, 'WithdrawRequestCreated');
            expectEvent(opResult, 'WithdrawFromVault', {_user: user1, _token: dai.address, _amount: "100"});

            let claimableAfter = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            //Since withdraw with enough liquidity is already tested, we need to check the claimable amount
            expect(claimableBefore.toString(), "Claimable tokens amount changed").to.equal(claimableAfter.toString());
            expect(claimableTotalBefore.toString(), "Total claimable tokens amount changed").to.equal(claimableTotalAfter.toString());
        });

        it('Withdraw does not influence claimable amount, withdraw request is created', async () => {
            //There is not enough liquidity in the vault
            let claimableBefore = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            let opResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});
            expectEvent(opResult, 'WithdrawRequestCreated');

            let claimableAfter = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            expect(claimableBefore.toString(), "Claimable tokens amount changed").to.equal(claimableAfter.toString());
            expect(claimableTotalBefore.toString(), "Total claimable tokens amount changed").to.equal(claimableTotalAfter.toString());
        });

        it('Deposit by operator does not influence claimable tokens', async () => {
            //Create on-hold record to be resolved
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 80, {from:defiops});

            let claimableBefore = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            //On-hold tokens are deposited
            expectEvent(opResult, 'DepositByOperator');

            let claimableAfter = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            expect(claimableBefore.toString(), "Claimable tokens amount changed").to.equal(claimableAfter.toString());
            expect(claimableTotalBefore.toString(), "Total claimable tokens amount changed").to.equal(claimableTotalAfter.toString());
        });

        it('Withdraw request resolving increases claimable amount', async () => {
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 100, {from:defiops});

            let claimableBefore = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            let opResult = await vaultProtocol.withdrawOperator({from: defiops});

            //Additional amount requested
            expectEvent(opResult, 'WithdrawByOperator');

            let claimableAfter = await vaultProtocol.claimableAmount(user1, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            //Increases by requested amount
            expect(claimableAfter.sub(claimableBefore).toNumber(), "Claimable tokens amount not changed").to.equal(100);
            expect(claimableTotalAfter.sub(claimableTotalBefore).toNumber(), "Total claimable tokens amount not changed").to.equal(100);
        });

        it('User claims all available tokens', async () => {
            let before = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                claimableTotal1: await vaultProtocol.totalClaimableAmount(dai.address),
                claimableTotal2: await vaultProtocol.totalClaimableAmount(usdc.address),
                claimableTotal3: await vaultProtocol.totalClaimableAmount(busd.address)
            };

            await vaultProtocol.claimRequested(user1, {from: user1});

            let after = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                claimable1: await vaultProtocol.claimableAmount(user1, dai.address),
                claimable2: await vaultProtocol.claimableAmount(user1, usdc.address),
                claimable3: await vaultProtocol.claimableAmount(user1, busd.address),
                claimableTotal1: await vaultProtocol.totalClaimableAmount(dai.address),
                claimableTotal2: await vaultProtocol.totalClaimableAmount(usdc.address),
                claimableTotal3: await vaultProtocol.totalClaimableAmount(busd.address)
            };

            expect(after.claimable1.toNumber(), "Not all tokens (1) are claimed").to.equal(0);
            expect(after.claimable2.toNumber(), "Not all tokens (2) are claimed").to.equal(0);
            expect(after.claimable3.toNumber(), "Not all tokens (3) are claimed").to.equal(0);

            expect(after.userBalance1.sub(before.userBalance1).toNumber(), "Tokens (1) are not claimed to user").to.equal(100);
            expect(after.userBalance2.sub(before.userBalance2).toNumber(), "Tokens (2) are not claimed to user").to.equal(50);
            expect(after.userBalance3.sub(before.userBalance3).toNumber(), "Tokens (3) are not claimed to user").to.equal(20);

            expect(before.vaultBalance1.sub(after.vaultBalance1).toNumber(), "Tokens (1) are not claimed from vault").to.equal(100);
            expect(before.vaultBalance2.sub(after.vaultBalance2).toNumber(), "Tokens (2) are not claimed to vault").to.equal(50);
            expect(before.vaultBalance3.sub(after.vaultBalance3).toNumber(), "Tokens (3) are not claimed to vault").to.equal(20);

            expect(before.claimableTotal1.sub(after.claimableTotal1).toNumber(), "Tokens (1) total is not changed").to.equal(100);
            expect(before.claimableTotal2.sub(after.claimableTotal2).toNumber(), "Tokens (2) total is not changed").to.equal(50);
            expect(before.claimableTotal3.sub(after.claimableTotal3).toNumber(), "Tokens (3) total is not changed").to.equal(20);
        });

        it('Claim by user does not influence other users claims', async () => {
            let claimableBefore = await vaultProtocol.claimableAmount(user2, dai.address);
            let claimableTotalBefore = await vaultProtocol.totalClaimableAmount(dai.address);

            await vaultProtocol.claimRequested(user1, {from: user1});

            let claimableAfter = await vaultProtocol.claimableAmount(user2, dai.address);
            let claimableTotalAfter = await vaultProtocol.totalClaimableAmount(dai.address);

            expect(claimableAfter.toString(), "Claimable tokens amount should not be changed for other users").to.equal(claimableBefore.toString());
            expect(claimableTotalBefore.sub(claimableTotalAfter).toNumber(), "Total claimable tokens amount not changed").to.equal(100);
        });

        it('Total claimable calculated correctly', async () => {
            //[180, 50, 20] - initial from before()
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user1, dai.address, 50, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, usdc.address, 80, {from:defiops});
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user3, busd.address, 180, {from:defiops});

            await vaultProtocol.withdrawOperator({from: defiops});


            let claimable1 = await vaultProtocol.totalClaimableAmount(dai.address);
            let claimable2 = await vaultProtocol.totalClaimableAmount(usdc.address);
            let claimable3 = await vaultProtocol.totalClaimableAmount(busd.address);

            expect(claimable1.toNumber(), "Incorrect total claimable (1)").to.equal(230);
            expect(claimable2.toNumber(), "Incorrect total claimable (2)").to.equal(130);
            expect(claimable3.toNumber(), "Incorrect total claimable (3)").to.equal(200);
        });
    });

    describe('Full cycle', () => {
        let snap: Snapshot;
        before(async () => {
            await dai.approve(vaultProtocol.address, 1000, {from:user1});
            await usdc.approve(vaultProtocol.address, 1000, {from:user1});
            await busd.approve(vaultProtocol.address, 1000, {from:user1});

            await dai.approve(vaultProtocol.address, 1000, {from:user2});
            await usdc.approve(vaultProtocol.address, 1000, {from:user2});
            await busd.approve(vaultProtocol.address, 1000, {from:user2});

            await dai.approve(vaultProtocol.address, 1000, {from:user2});
            await usdc.approve(vaultProtocol.address, 1000, {from:user2});
            await busd.approve(vaultProtocol.address, 1000, {from:user2});

            snap = await Snapshot.create(web3.currentProvider);
        });

        after(async () => {
            await globalSnap.revert();
        });

        afterEach(async () => {
            await snap.revert();
        });

        it('All deposited funds plus yeild equal to all withdrawn funds', async () => {
            let before1 = {
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };

            await dai.approve(vaultProtocol.address, 100, {from:user1});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 30, {from:defiops});
            await dai.approve(vaultProtocol.address, 100, {from:user2});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user2, dai.address, 20, {from:defiops});
            await dai.approve(vaultProtocol.address, 100, {from:user3});
            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user3, dai.address, 10, {from:defiops});

            let onhold1 = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold1.toNumber(), "Deposit (1) was not added to on-hold").to.equal(30);

            onhold1 = await vaultProtocol.amountOnHold(user2, dai.address);
            expect(onhold1.toNumber(), "Deposit (2) was not added to on-hold").to.equal(20);

            onhold1 = await vaultProtocol.amountOnHold(user3, dai.address);
            expect(onhold1.toNumber(), "Deposit (2) was not added to on-hold").to.equal(10);

            let after1 = {
                vaultBalance: await dai.balanceOf(vaultProtocol.address)
            };
            expect(after1.vaultBalance.sub(before1.vaultBalance).toNumber(), "Tokens are not transferred to vault").to.equal(60);

            let opResult1 = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent(opResult1, 'DepositByOperator', {_amount: "60"});

            onhold1 = await vaultProtocol.amountOnHold(user1, dai.address);
            expect(onhold1.toNumber(), "On-hold record (1) should be deleted").to.equal(0);

            onhold1 = await vaultProtocol.amountOnHold(user2, dai.address);
            expect(onhold1.toNumber(), "On-hold record (2) should be deleted").to.equal(0);

            onhold1 = await vaultProtocol.amountOnHold(user3, dai.address);
            expect(onhold1.toNumber(), "On-hold record (2) should be deleted").to.equal(0);

            console.log(`>>>`);

            console.log((await dai.balanceOf(protocolStub)).toString());




            await dai.transfer(protocolStub,20*3,{from:owner});





            //half of deposit and half of withdraw requests
            let before2 = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };
            //Withdraw requests created

            //must create withdraw request
            await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user2, dai.address, 40, {from:defiops});

            await (<any> vaultProtocol).methods['depositToVault(address,address,uint256)'](user1, dai.address, 30, {from:defiops});
            //must be withdrawn now
            let withdrawFromVaultResult = await (<any> vaultProtocol).methods['withdrawFromVault(address,address,uint256)'](user3, dai.address, 30, {from:defiops});
            expectEvent(withdrawFromVaultResult, 'WithdrawFromVault', {_amount: "30"});



            //half of withdraws are fullfilled and half is requested

            let opResult2 = await vaultProtocol.withdrawOperator({from: defiops});

            expectEvent.notEmitted(opResult2, 'DepositByOperator');
            expectEvent(opResult2, 'WithdrawReqestsResolved');
            expectEvent(opResult2, 'WithdrawByOperator', {_amount: "40"});

            //Withdraw requests are resolved
            let requested = await vaultProtocol.amountRequested(user2, dai.address);
            expect(requested.toNumber(), "Withdraw request (1) should be resolved").to.equal(0);

            let after2 = {
                userBalance1: await dai.balanceOf(user1),
                userBalance2: await usdc.balanceOf(user1),
                userBalance3: await busd.balanceOf(user1),
                vaultBalance1: await dai.balanceOf(vaultProtocol.address),
                vaultBalance2: await usdc.balanceOf(vaultProtocol.address),
                vaultBalance3: await busd.balanceOf(vaultProtocol.address),
                protocolBalance1: await dai.balanceOf(protocolStub),
                protocolBalance2: await usdc.balanceOf(protocolStub),
                protocolBalance3: await busd.balanceOf(protocolStub)
            };

            //tokens to claim
            let claimable = await vaultProtocol.claimableAmount(user1, dai.address);
            console.log(claimable.toString());
            // expect(claimable.toNumber(), "Cannot claim tokens (1)").to.equal(100);
            claimable = await vaultProtocol.claimableAmount(user1, usdc.address);
            console.log(claimable.toString());
            // expect(claimable.toNumber(), "Cannot claim tokens (2)").to.equal(50);
            claimable = await vaultProtocol.claimableAmount(user1, busd.address);
            console.log(claimable.toString());
            // expect(claimable.toNumber(), "Cannot claim tokens (3)").to.equal(10);

            //operator handles deposits/requests to the protocol

            //yield 2 on the protocol (+20 to everyone with deposit)

            //Total withdraws

            //user balances are the same + yeild

            // check claim ability + check claim profit

        });
    });

    describe('Quick withdraw', () => {
        it('Quick withdraw (enough liquidity)', async () => {
            let res = true;
            expect(res, 'Some message').to.be.true;

            //Token (requested amount) is transfered to the user
        });

        it('Quick withdraw (has on-hold token, enough liquidity)', async () => {
            let res = true;
            expect(res, 'Some message').to.be.true;

            //Deposit record is removed from the on-hold storage
            //Token is transfered to the user
        });

        it('Quick withdraw (has on-hold token, not enough liquidity)', async () => {
            let res = true;
            expect(res, 'Some message').to.be.true;

            //Deposit record is removed from the on-hold storage
            // (requested amount - on-hold tokens) is returned from the protocol
            //Token is transfered to the user
        });

        it('Quick withdraw (not enough liquidity)', async () => {
            let res = true;
            expect(res, 'Some message').to.be.true;

            // requested amount is returned from the protocol
            //Token is transfered to the user
        });
    });

    describe('Registered tokens only', () => {
        //operation with not registered token
        //supportedTokens()
        //supportedtokensCount()

        it('Supported tokens count', async () => {
            //Check already registered
            let tokensRegistered = await vaultProtocol.supportedTokensCount();
            expect(tokensRegistered.toNumber(), "Incorrect number of registered tokens").to.equal(3);
        });
    });

});