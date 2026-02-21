// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  EscrowPredictionPool
 * @notice Users deposit ETH predicting the winner of an Agent AQI Arena battle.
 *         All deposits are 100% refundable after resolution — no redistribution.
 *         Correct predictors earn on-chain points redeemable as a leaderboard.
 *
 * @dev    Deployed on Base Sepolia for the ETHDenver Agent AQI demo.
 *
 *         Battle ID mapping
 *         -----------------
 *         The off-chain battleId is a UUID string (e.g. "a3f2b1c4-…").
 *         Convert it to uint256 before calling:
 *
 *           JS:      BigInt("0x" + crypto.createHash("sha256")
 *                      .update(battleIdString).digest("hex"))
 *           cast:    cast keccak <battleIdString>   (returns bytes32; cast to uint256)
 *
 *         Agent ID mapping
 *         ----------------
 *           0 = SafeGuard   (safe)
 *           1 = SpeedRunner (fast)
 *           2 = GasOptimizer (cheap)
 *
 *         Points formula
 *         --------------
 *           earned = 1 + min(floor(amount / 0.001 ether), MAX_POINTS - 1)
 *           → minimum 1 point, maximum MAX_POINTS (10) per battle
 */
contract EscrowPredictionPool {

    // ─── Inline auth ──────────────────────────────────────────────────────────

    address public immutable owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── Reentrancy guard ─────────────────────────────────────────────────────

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "Reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ─── Data types ───────────────────────────────────────────────────────────

    struct Prediction {
        uint8   agentId;
        uint256 amount;
        bool    withdrawn;
        bool    pointsClaimed;
    }

    struct BattleInfo {
        bool  exists;
        bool  resolved;
        uint8 winnerAgentId;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Total ETH backing each agent in each battle.
    ///         battleTotals[battleId][agentId]
    mapping(uint256 => mapping(uint8 => uint256)) public battleTotals;

    /// @notice On-chain leaderboard points per address.
    mapping(address => uint256) public points;

    mapping(uint256 => BattleInfo)                        private _battles;
    mapping(uint256 => mapping(address => Prediction))    private _predictions;

    // Points formula constants
    uint256 public constant POINTS_UNIT = 0.001 ether; // 1 bonus point per 0.001 ETH
    uint256 public constant MAX_POINTS  = 10;           // cap per battle

    // ─── Events ───────────────────────────────────────────────────────────────

    event PredictionPlaced(
        uint256 indexed battleId,
        address indexed bettor,
        uint8           agentId,
        uint256         amount
    );

    event BattleResolved(
        uint256 indexed battleId,
        uint8           winnerAgentId
    );

    event Withdrawn(
        uint256 indexed battleId,
        address indexed bettor,
        uint256         amount
    );

    event PointsClaimed(
        uint256 indexed battleId,
        address indexed bettor,
        uint256         earned
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Core functions ───────────────────────────────────────────────────────

    /**
     * @notice Deposit ETH to predict the winner of a battle.
     * @param battleId  uint256 derived from the Arena battle UUID (see @dev notes).
     * @param agentId   0=SafeGuard, 1=SpeedRunner, 2=GasOptimizer.
     *
     * Requirements:
     *   - msg.value > 0
     *   - agentId in {0, 1, 2}
     *   - Battle must not be resolved yet
     *   - Caller must not have already placed a prediction in this battle
     */
    function placePrediction(uint256 battleId, uint8 agentId) external payable {
        require(msg.value > 0, "No ETH sent");
        require(agentId   <= 2, "Invalid agentId: must be 0, 1, or 2");

        BattleInfo storage b = _battles[battleId];
        require(!b.resolved, "Battle already resolved");

        Prediction storage p = _predictions[battleId][msg.sender];
        require(p.amount == 0, "Already predicted in this battle");

        // Auto-create the battle record on first prediction
        if (!b.exists) {
            b.exists = true;
        }

        battleTotals[battleId][agentId] += msg.value;

        _predictions[battleId][msg.sender] = Prediction({
            agentId:       agentId,
            amount:        msg.value,
            withdrawn:     false,
            pointsClaimed: false
        });

        emit PredictionPlaced(battleId, msg.sender, agentId, msg.value);
    }

    /**
     * @notice Record the winning agent once the off-chain battle concludes.
     * @dev    Points are NOT distributed here (would require an unbounded loop).
     *         Users pull their own points via claimPoints().
     * @param battleId      uint256 battle identifier.
     * @param winnerAgentId 0, 1, or 2.
     *
     * Requirements:
     *   - Caller must be owner
     *   - Battle must exist (at least one prediction placed)
     *   - Battle must not already be resolved
     */
    function resolveBattle(uint256 battleId, uint8 winnerAgentId) external onlyOwner {
        BattleInfo storage b = _battles[battleId];
        require(b.exists,    "Battle does not exist");
        require(!b.resolved, "Already resolved");
        require(winnerAgentId <= 2, "Invalid winnerAgentId");

        b.resolved      = true;
        b.winnerAgentId = winnerAgentId;

        emit BattleResolved(battleId, winnerAgentId);
    }

    /**
     * @notice Claim back your original deposit after the battle is resolved.
     *         Always 100% of deposited amount — no slippage, no fees.
     * @param battleId  Battle to withdraw from.
     *
     * Requirements:
     *   - Battle must be resolved
     *   - Caller must have a non-zero prediction
     *   - Must not have already withdrawn
     */
    function withdraw(uint256 battleId) external nonReentrant {
        BattleInfo storage b = _battles[battleId];
        require(b.resolved, "Battle not resolved yet");

        Prediction storage p = _predictions[battleId][msg.sender];
        require(p.amount > 0,  "No prediction found");
        require(!p.withdrawn,  "Already withdrawn");

        // Mark withdrawn before transfer (checks-effects-interactions)
        p.withdrawn    = true;
        uint256 refund = p.amount;

        (bool ok, ) = msg.sender.call{value: refund}("");
        require(ok, "ETH transfer failed");

        emit Withdrawn(battleId, msg.sender, refund);
    }

    /**
     * @notice Claim on-chain points for a correct prediction.
     *         Points = 1 + floor(amount / 0.001 ETH), capped at MAX_POINTS.
     *         Separate from withdraw so users keep points even if they don't withdraw.
     * @param battleId  Battle to claim points for.
     *
     * Requirements:
     *   - Battle must be resolved
     *   - Caller must have a non-zero prediction
     *   - Prediction must be for the winning agent
     *   - Points must not already be claimed for this battle
     */
    function claimPoints(uint256 battleId) external {
        BattleInfo storage b = _battles[battleId];
        require(b.resolved, "Battle not resolved yet");

        Prediction storage p = _predictions[battleId][msg.sender];
        require(p.amount > 0,              "No prediction found");
        require(!p.pointsClaimed,          "Points already claimed");
        require(p.agentId == b.winnerAgentId, "Prediction was incorrect");

        p.pointsClaimed = true;

        uint256 bonus  = p.amount / POINTS_UNIT;
        if (bonus > MAX_POINTS - 1) bonus = MAX_POINTS - 1;
        uint256 earned = 1 + bonus;

        points[msg.sender] += earned;

        emit PointsClaimed(battleId, msg.sender, earned);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Get total ETH backing each agent in a battle.
     * @param  battleId  Battle to query.
     * @return total0    ETH pot for SafeGuard   (agentId 0).
     * @return total1    ETH pot for SpeedRunner  (agentId 1).
     * @return total2    ETH pot for GasOptimizer (agentId 2).
     */
    function getBattleTotals(uint256 battleId)
        external
        view
        returns (uint256 total0, uint256 total1, uint256 total2)
    {
        return (
            battleTotals[battleId][0],
            battleTotals[battleId][1],
            battleTotals[battleId][2]
        );
    }

    /**
     * @notice Get a user's prediction details for a specific battle.
     * @param  battleId  Battle to query.
     * @param  user      Address to look up.
     * @return agentId   Agent backed (0/1/2). 0 when no prediction exists — check amount.
     * @return amount    ETH deposited (0 = no prediction made).
     * @return withdrawn Whether the deposit has already been refunded.
     */
    function getUserPrediction(uint256 battleId, address user)
        external
        view
        returns (uint8 agentId, uint256 amount, bool withdrawn)
    {
        Prediction storage p = _predictions[battleId][user];
        return (p.agentId, p.amount, p.withdrawn);
    }

    /**
     * @notice Get battle metadata.
     * @param  battleId     Battle to query.
     * @return exists       True if at least one prediction has been placed.
     * @return resolved     True if resolveBattle() has been called.
     * @return winnerAgentId The winning agentId (only meaningful when resolved=true).
     */
    function getBattle(uint256 battleId)
        external
        view
        returns (bool exists, bool resolved, uint8 winnerAgentId)
    {
        BattleInfo storage b = _battles[battleId];
        return (b.exists, b.resolved, b.winnerAgentId);
    }
}
