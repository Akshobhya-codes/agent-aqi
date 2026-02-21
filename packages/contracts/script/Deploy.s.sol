// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowPredictionPool} from "../src/EscrowPredictionPool.sol";

/**
 * @title  Deploy
 * @notice Foundry broadcast script — deploys EscrowPredictionPool to Base Sepolia.
 *
 * Usage
 * -----
 * 1. Copy .env.example → .env and fill in your values.
 * 2. Source env:      source .env
 * 3. Dry-run (no tx): forge script script/Deploy.s.sol --rpc-url base_sepolia
 * 4. Broadcast:
 *      forge script script/Deploy.s.sol \
 *        --rpc-url base_sepolia          \
 *        --broadcast                     \
 *        --verify                        \
 *        --etherscan-api-key $BASESCAN_API_KEY
 *
 * After deploy, save the printed address to .env as ESCROW_POOL_ADDRESS.
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console2.log("Deployer:   ", deployer);
        console2.log("Balance:    ", deployer.balance);
        console2.log("Chain ID:   ", block.chainid);

        vm.startBroadcast(deployerKey);

        EscrowPredictionPool pool = new EscrowPredictionPool();

        vm.stopBroadcast();

        console2.log("EscrowPredictionPool deployed at:", address(pool));
        console2.log("Owner:                           ", pool.owner());
    }
}
