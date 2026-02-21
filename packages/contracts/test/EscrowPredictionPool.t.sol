// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {EscrowPredictionPool} from "../src/EscrowPredictionPool.sol";

contract EscrowPredictionPoolTest is Test {

    EscrowPredictionPool internal pool;

    address internal owner   = makeAddr("owner");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal charlie = makeAddr("charlie");

    uint256 internal constant BATTLE = 1;

    function setUp() public {
        vm.prank(owner);
        pool = new EscrowPredictionPool();

        vm.deal(alice,   1 ether);
        vm.deal(bob,     1 ether);
        vm.deal(charlie, 1 ether);
    }

    // ─── placePrediction ──────────────────────────────────────────────────────

    function test_PlacePrediction_StoresTotals() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(bob);
        pool.placePrediction{value: 0.02 ether}(BATTLE, 1);

        (uint256 t0, uint256 t1, uint256 t2) = pool.getBattleTotals(BATTLE);
        assertEq(t0, 0.01 ether);
        assertEq(t1, 0.02 ether);
        assertEq(t2, 0);

        (bool exists, bool resolved, ) = pool.getBattle(BATTLE);
        assertTrue(exists);
        assertFalse(resolved);
    }

    function test_PlacePrediction_RevertZeroValue() public {
        vm.prank(alice);
        vm.expectRevert("No ETH sent");
        pool.placePrediction{value: 0}(BATTLE, 0);
    }

    function test_PlacePrediction_RevertInvalidAgent() public {
        vm.prank(alice);
        vm.expectRevert("Invalid agentId: must be 0, 1, or 2");
        pool.placePrediction{value: 0.01 ether}(BATTLE, 3);
    }

    function test_PlacePrediction_RevertDoublePrediction() public {
        vm.startPrank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);
        vm.expectRevert("Already predicted in this battle");
        pool.placePrediction{value: 0.01 ether}(BATTLE, 1);
        vm.stopPrank();
    }

    // ─── resolveBattle ────────────────────────────────────────────────────────

    function test_ResolveBattle() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        (, bool resolved, uint8 winner) = pool.getBattle(BATTLE);
        assertTrue(resolved);
        assertEq(winner, 0);
    }

    function test_ResolveBattle_RevertNonOwner() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(alice);
        vm.expectRevert("Not owner");
        pool.resolveBattle(BATTLE, 0);
    }

    function test_ResolveBattle_RevertNonExistent() public {
        vm.prank(owner);
        vm.expectRevert("Battle does not exist");
        pool.resolveBattle(BATTLE, 0);
    }

    function test_ResolveBattle_RevertDoubleResolve() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.startPrank(owner);
        pool.resolveBattle(BATTLE, 0);
        vm.expectRevert("Already resolved");
        pool.resolveBattle(BATTLE, 1);
        vm.stopPrank();
    }

    function test_PlacePrediction_RevertAfterResolution() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.prank(bob);
        vm.expectRevert("Battle already resolved");
        pool.placePrediction{value: 0.01 ether}(BATTLE, 1);
    }

    // ─── withdraw ─────────────────────────────────────────────────────────────

    function test_Withdraw_FullRefund() public {
        uint256 deposit = 0.05 ether;

        vm.prank(alice);
        pool.placePrediction{value: deposit}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        uint256 before = alice.balance;
        vm.prank(alice);
        pool.withdraw(BATTLE);

        assertEq(alice.balance, before + deposit);

        // getUserPrediction shows withdrawn=true
        (, , bool withdrawn) = pool.getUserPrediction(BATTLE, alice);
        assertTrue(withdrawn);
    }

    function test_Withdraw_RevertDoubleWithdraw() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.startPrank(alice);
        pool.withdraw(BATTLE);
        vm.expectRevert("Already withdrawn");
        pool.withdraw(BATTLE);
        vm.stopPrank();
    }

    function test_Withdraw_RevertBeforeResolution() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(alice);
        vm.expectRevert("Battle not resolved yet");
        pool.withdraw(BATTLE);
    }

    function test_Withdraw_RevertNoPrediction() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.prank(bob);
        vm.expectRevert("No prediction found");
        pool.withdraw(BATTLE);
    }

    // ─── claimPoints ──────────────────────────────────────────────────────────

    function test_ClaimPoints_BaseCase() public {
        // Alice bets 0 < amount < 0.001 ETH → earns 1 point (no bonus)
        vm.prank(alice);
        pool.placePrediction{value: 0.0005 ether}(BATTLE, 2);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 2);

        vm.prank(alice);
        pool.claimPoints(BATTLE);

        assertEq(pool.points(alice), 1);
    }

    function test_ClaimPoints_BonusPoints() public {
        // Bob bets 0.005 ETH → 1 base + 5 bonus = 6 points
        vm.prank(bob);
        pool.placePrediction{value: 0.005 ether}(BATTLE, 1);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 1);

        vm.prank(bob);
        pool.claimPoints(BATTLE);

        assertEq(pool.points(bob), 6);
    }

    function test_ClaimPoints_CapAtMaxPoints() public {
        // Charlie bets 1 ETH → would be 1001 bonus; capped to MAX_POINTS (10)
        vm.prank(charlie);
        pool.placePrediction{value: 1 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.prank(charlie);
        pool.claimPoints(BATTLE);

        assertEq(pool.points(charlie), pool.MAX_POINTS());
    }

    function test_ClaimPoints_RevertIncorrectPrediction() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0); // bet on 0

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 1); // 1 wins

        vm.prank(alice);
        vm.expectRevert("Prediction was incorrect");
        pool.claimPoints(BATTLE);
    }

    function test_ClaimPoints_RevertDoubleClaim() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.startPrank(alice);
        pool.claimPoints(BATTLE);
        vm.expectRevert("Points already claimed");
        pool.claimPoints(BATTLE);
        vm.stopPrank();
    }

    // ─── Points independent of withdraw ───────────────────────────────────────

    function test_WithdrawAndClaimPoints_Independent() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.003 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.startPrank(alice);
        pool.withdraw(BATTLE);     // refund first
        pool.claimPoints(BATTLE);  // then claim points — should still work
        vm.stopPrank();

        // 1 base + 3 bonus = 4 points (0.003 / 0.001 = 3 bonus)
        assertEq(pool.points(alice), 4);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function test_GetUserPrediction() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 2);

        (uint8 agentId, uint256 amount, bool withdrawn) =
            pool.getUserPrediction(BATTLE, alice);

        assertEq(agentId,  2);
        assertEq(amount,   0.01 ether);
        assertFalse(withdrawn);
    }

    function test_GetUserPrediction_NoPrediction() public view {
        (uint8 agentId, uint256 amount, bool withdrawn) =
            pool.getUserPrediction(BATTLE, alice);

        assertEq(agentId, 0);
        assertEq(amount,  0);
        assertFalse(withdrawn);
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    function test_EmitPredictionPlaced() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit EscrowPredictionPool.PredictionPlaced(BATTLE, alice, 1, 0.01 ether);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 1);
    }

    function test_EmitBattleResolved() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit EscrowPredictionPool.BattleResolved(BATTLE, 0);
        pool.resolveBattle(BATTLE, 0);
    }

    function test_EmitWithdrawn() public {
        vm.prank(alice);
        pool.placePrediction{value: 0.01 ether}(BATTLE, 0);

        vm.prank(owner);
        pool.resolveBattle(BATTLE, 0);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit EscrowPredictionPool.Withdrawn(BATTLE, alice, 0.01 ether);
        pool.withdraw(BATTLE);
    }
}
