// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/Openfront.sol";

contract DeployOpenfront is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying Openfront contract...");
        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // For local deployment, we'll use the deployer as the game server initially
        // This can be changed later using setGameServer() function
        Openfront openfront = new Openfront(deployer);
        
        vm.stopBroadcast();
        
        console.log("Openfront contract deployed at:", address(openfront));
        console.log("Contract owner:", openfront.owner());
        console.log("Game server:", openfront.gameServer());
        
        console.log("Deployment completed successfully!");
    }
}
