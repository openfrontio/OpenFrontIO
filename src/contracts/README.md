# Openfront Smart Contracts

This directory contains the smart contracts for the Openfront on-chain gaming platform, built using the Foundry toolkit.

## Overview

The Openfront contract handles on-chain betting and prize distribution for Openfront games:

- **Lobby Management**: Create and join game lobbies with ETH stakes
- **Game Lifecycle**: Start games, declare winners, claim prizes
- **Security**: Access controls, reentrancy protection, validation

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed
- [Node.js](https://nodejs.org/) for frontend integration

### 1. Install Dependencies

```shell
# Install OpenZeppelin contracts via npm (from contracts directory)
npm install @openzeppelin/contracts

# Note: Make sure foundry.toml has correct remappings:
# remappings = [
#     "@openzeppelin/contracts/=../../node_modules/@openzeppelin/contracts/",
#     "@openzeppelin/=../../node_modules/@openzeppelin/"
# ]
```

### 2. Build Contracts

```shell
forge build
```

### 3. Deploy to Local Anvil

#### Start Local Anvil Node

```shell
# Terminal 1: Start Anvil (local Ethereum node)
anvil
```

This will output test accounts with private keys. Copy one of the private keys for deployment.

#### Deploy Contract on Local Anvil

```shell
# Terminal 2: Deploy the contract (first account is deployer)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 forge script script/DeployOpenfront.s.sol:DeployOpenfront --rpc-url http://localhost:8545 --broadcast
```

#### Example Output

```
Deploying Openfront contract...
Deployer address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Deployer balance: 10000000000000000000000
Openfront contract deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Contract owner: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Game server: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Deployment info saved to ./deployments/local.json
```

The contract address will be saved to `./deployments/local.json` for frontend integration.

### 4. Interact with Contract

#### Using Cast (CLI)

```shell
# Get contract info
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 "owner()" --rpc-url http://localhost:8545

# Create a lobby (example with 0.1 ETH bet)
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "createLobby(bytes32,uint256)" 0x1234567890123456789012345678901234567890123456789012345678901234 100000000000000000 --value 100000000000000000 --private-key http://localhost:8545 < PRIVATE_KEY > --rpc-url
```

## Development Workflow

### Testing

```shell
# Run all tests
forge test

# Run tests with verbosity
forge test -vvv

# Run specific test
forge test --match-test testCreateLobby
```

### Deployment to Other Networks

#### Base Sepolia (Testnet)

```shell
# Set environment variables
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
export PRIVATE_KEY="your-private-key"

# Deploy to Base Sepolia
forge script script/DeployOpenfront.s.sol:DeployOpenfront --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```

#### Environment Setup

Create a `.env` file in the contracts directory:

```env
PRIVATE_KEY=0x1234...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ETHERSCAN_API_KEY=your-api-key
```

### Contract Integration

The deployed contract address and ABI are saved to `./deployments/local.json`:

```json
{
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "owner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "gameServer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
}
```

Use this in your frontend to connect to the deployed contract.

## Contract Functions

### Core Functions

- `createLobby(bytes32 lobbyId, uint256 betAmount)` - Create new lobby
- `joinLobby(bytes32 lobbyId)` - Join existing lobby
- `startGame(bytes32 lobbyId)` - Start game (host only)
- `declareWinner(bytes32 lobbyId, address winner)` - Declare winner (game server only)
- `claimPrize(bytes32 lobbyId)` - Claim prize (winner only)

### View Functions

- `getLobby(bytes32 lobbyId)` - Get lobby details
- `getParticipantCount(bytes32 lobbyId)` - Get participant count
- `isParticipant(bytes32 lobbyId, address participant)` - Check participation

## Troubleshooting

### Common Issues

#### OpenZeppelin Import Errors

If you see an error like:
```
Source "node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol" not found
```

**Solution**: Make sure:
1. OpenZeppelin is installed: `npm install @openzeppelin/contracts` (from contracts directory)
2. Your `foundry.toml` has correct remappings pointing to the right path:
   ```toml
   remappings = [
       "@openzeppelin/contracts/=../../node_modules/@openzeppelin/contracts/",
       "@openzeppelin/=../../node_modules/@openzeppelin/"
   ]
   ```

#### Git Submodule Issues

If forge install fails with git submodule errors, use npm install instead as shown above.

## Foundry Documentation

https://book.getfoundry.sh/
