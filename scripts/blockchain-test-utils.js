#!/usr/bin/env node

/**
 * Blockchain Test Utilities for WinModal Testing
 * 
 * This module provides utilities for testing blockchain interactions
 * in the OpenFront gaming platform, specifically for WinModal features.
 */

import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

// Test configuration
const ANVIL_RPC_URL = 'http://localhost:8545';
const CONTRACT_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Contract ABI for the functions we need
const OPENFRONT_ABI = [
  {
    "inputs": [{"name": "lobbyId", "type": "bytes32"}],
    "name": "getLobby",
    "outputs": [
      {"name": "host", "type": "address"},
      {"name": "betAmount", "type": "uint256"},
      {"name": "participants", "type": "address[]"},
      {"name": "status", "type": "uint8"},
      {"name": "winner", "type": "address"},
      {"name": "totalPrize", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "lobbyId", "type": "bytes32"}],
    "name": "startGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "lobbyId", "type": "bytes32"},
      {"name": "winner", "type": "address"}
    ],
    "name": "declareWinner",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "lobbyId", "type": "bytes32"}],
    "name": "claimPrize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "lobbyId", "type": "bytes32", "indexed": true},
      {"name": "host", "type": "address", "indexed": true},
      {"name": "betAmount", "type": "uint256", "indexed": false}
    ],
    "name": "LobbyCreated",
    "type": "event",
    "anonymous": false
  }
];

// Game status enum
const GameStatus = {
  0: 'Created',
  1: 'InProgress', 
  2: 'Finished',
  3: 'Claimed',
  Created: 0,
  InProgress: 1,
  Finished: 2,
  Claimed: 3
};

class BlockchainTestUtils {
  constructor() {
    this.account = privateKeyToAccount(ANVIL_PRIVATE_KEY);
    this.client = createWalletClient({
      account: this.account,
      chain: foundry,
      transport: http(ANVIL_RPC_URL)
    }).extend(publicActions);
  }

  /**
   * Check if Anvil blockchain is running
   */
  async checkAnvilConnection() {
    try {
      const chainId = await this.client.getChainId();
      return { success: true, chainId };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to connect to Anvil: ${error.message}` 
      };
    }
  }

  /**
   * Check if the contract is deployed
   */
  async checkContractDeployment() {
    try {
      const code = await this.client.getBytecode({ 
        address: CONTRACT_ADDRESS 
      });
      
      if (!code || code === '0x') {
        return { 
          success: false, 
          error: `No contract deployed at ${CONTRACT_ADDRESS}` 
        };
      }
      
      return { success: true, address: CONTRACT_ADDRESS };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to check contract: ${error.message}` 
      };
    }
  }

  /**
   * Get lobby information from the blockchain
   */
  async getLobbyInfo(lobbyId) {
    try {
      const result = await this.client.readContract({
        address: CONTRACT_ADDRESS,
        abi: OPENFRONT_ABI,
        functionName: 'getLobby',
        args: [lobbyId]
      });

      const [host, betAmount, participants, status, winner, totalPrize] = result;
      
      return {
        success: true,
        lobby: {
          host,
          betAmount,
          participants,
          totalPrize,
          status,
          statusName: GameStatus[status],
          winner,
          participantCount: participants?.length || 0,
          lobbyId
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to get lobby info: ${error.message}` 
      };
    }
  }

  /**
   * Start a game on the blockchain
   */
  async startGame(lobbyId) {
    try {
      const hash = await this.client.writeContract({
        address: CONTRACT_ADDRESS,
        abi: OPENFRONT_ABI,
        functionName: 'startGame',
        args: [lobbyId]
      });

      // Wait for transaction confirmation
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      
      return {
        success: true,
        transactionHash: hash,
        receipt,
        message: `Game started successfully. Transaction: ${hash}`
      };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to start game: ${error.message}` 
      };
    }
  }

  /**
   * Declare winner on the blockchain
   */
  async declareWinner(lobbyId, winnerAddress = ANVIL_ADDRESS) {
    try {
      const hash = await this.client.writeContract({
        address: CONTRACT_ADDRESS,
        abi: OPENFRONT_ABI,
        functionName: 'declareWinner',
        args: [lobbyId, winnerAddress]
      });

      // Wait for transaction confirmation
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      
      return {
        success: true,
        transactionHash: hash,
        receipt,
        winnerAddress,
        message: `Winner declared successfully. Transaction: ${hash}`
      };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to declare winner: ${error.message}` 
      };
    }
  }

  /**
   * Claim prize on the blockchain
   */
  async claimPrize(lobbyId) {
    try {
      const hash = await this.client.writeContract({
        address: CONTRACT_ADDRESS,
        abi: OPENFRONT_ABI,
        functionName: 'claimPrize',
        args: [lobbyId]
      });

      // Wait for transaction confirmation
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      
      return {
        success: true,
        transactionHash: hash,
        receipt,
        message: `Prize claimed successfully. Transaction: ${hash}`
      };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to claim prize: ${error.message}` 
      };
    }
  }

  /**
   * Get all lobbies by scanning LobbyCreated events
   */
  async getAllLobbies() {
    console.log('🔍 Scanning blockchain for all lobbies...\n');
    
    try {
      // Get all LobbyCreated events from the contract
      const logs = await this.client.getLogs({
        address: CONTRACT_ADDRESS,
        event: {
          type: 'event',
          name: 'LobbyCreated',
          inputs: [
            {name: 'lobbyId', type: 'bytes32', indexed: true},
            {name: 'host', type: 'address', indexed: true},
            {name: 'betAmount', type: 'uint256', indexed: false}
          ]
        },
        fromBlock: 'earliest',
        toBlock: 'latest'
      });

      if (logs.length === 0) {
        console.log('❌ No lobbies found on the blockchain');
        return { success: true, lobbies: [] };
      }

      console.log(`📋 Found ${logs.length} lobbies on the blockchain:\n`);

      const lobbies = [];
      
      // Get detailed info for each lobby
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const lobbyId = log.args.lobbyId;
        const host = log.args.host;
        const creationBetAmount = log.args.betAmount;

        console.log(`🔍 Checking lobby ${i + 1}/${logs.length}: ${lobbyId}`);

        // Get current lobby state
        const lobbyInfo = await this.getLobbyInfo(lobbyId);
        
        if (lobbyInfo.success) {
          const lobby = {
            ...lobbyInfo.lobby,
            creationBetAmount,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash
          };
          
          lobbies.push(lobby);
          
          // Display summary
          console.log(`  📊 Status: ${lobby.statusName} (${lobby.status})`);
          console.log(`  🏠 Host: ${lobby.host}`);
          console.log(`  💰 Prize: ${this.formatEther(lobby.totalPrize)} ETH`);
          console.log(`  👥 Participants: ${lobby.participantCount || lobby.participants?.length || 'Unknown'}`);
          console.log(`  🎯 Winner: ${lobby.winner === '0x0000000000000000000000000000000000000000' ? 'None' : lobby.winner}`);
          console.log('');
        } else {
          console.log(`  ❌ Failed to get details: ${lobbyInfo.error}\n`);
        }
      }

      return { success: true, lobbies, totalFound: logs.length };
      
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to scan lobbies: ${error.message}` 
      };
    }
  }

  /**
   * Test complete lobby state progression
   */
  async testLobbyProgression(lobbyId) {
    console.log(`\n🔄 Testing lobby state progression for: ${lobbyId}\n`);
    
    const results = [];
    
    // Step 1: Check initial state
    console.log('Step 1: Checking initial lobby state...');
    const initialState = await this.getLobbyInfo(lobbyId);
    results.push({ step: 'Initial State', ...initialState });
    
    if (initialState.success) {
      console.log(`   Status: ${initialState.lobby.statusName} (${initialState.lobby.status})`);
      console.log(`   Prize Pool: ${this.formatEther(initialState.lobby.totalPrize)} ETH`);
    } else {
      console.log(`   ❌ Error: ${initialState.error}`);
      return results;
    }
    
    // Step 2: Start game if not already started
    if (initialState.lobby.status === GameStatus.Created) {
      console.log('\nStep 2: Starting game...');
      const startResult = await this.startGame(lobbyId);
      results.push({ step: 'Start Game', ...startResult });
      
      if (startResult.success) {
        console.log(`   ✅ ${startResult.message}`);
        await this.sleep(2000); // Wait for transaction to be mined
      } else {
        console.log(`   ❌ ${startResult.error}`);
      }
    } else {
      console.log('\nStep 2: Game already started, skipping...');
    }
    
    // Step 3: Check state after start
    console.log('\nStep 3: Checking state after game start...');
    const afterStartState = await this.getLobbyInfo(lobbyId);
    results.push({ step: 'After Start State', ...afterStartState });
    
    if (afterStartState.success) {
      console.log(`   Status: ${afterStartState.lobby.statusName} (${afterStartState.lobby.status})`);
    }
    
    // Step 4: Declare winner if game is in progress
    if (afterStartState.success && afterStartState.lobby.status === GameStatus.InProgress) {
      console.log('\nStep 4: Declaring winner...');
      const winnerResult = await this.declareWinner(lobbyId);
      results.push({ step: 'Declare Winner', ...winnerResult });
      
      if (winnerResult.success) {
        console.log(`   ✅ ${winnerResult.message}`);
        console.log(`   Winner: ${winnerResult.winnerAddress}`);
        await this.sleep(2000); // Wait for transaction to be mined
      } else {
        console.log(`   ❌ ${winnerResult.error}`);
      }
    } else {
      console.log('\nStep 4: Game not in progress, skipping winner declaration...');
    }
    
    // Step 5: Check final state
    console.log('\nStep 5: Checking final lobby state...');
    const finalState = await this.getLobbyInfo(lobbyId);
    results.push({ step: 'Final State', ...finalState });
    
    if (finalState.success) {
      console.log(`   Status: ${finalState.lobby.statusName} (${finalState.lobby.status})`);
      console.log(`   Prize Pool: ${this.formatEther(finalState.lobby.totalPrize)} ETH`);
      
      if (finalState.lobby.status === GameStatus.Finished) {
        console.log('   🏆 Ready for prize claim!');
      } else if (finalState.lobby.status === GameStatus.Claimed) {
        console.log('   🎉 Prize already claimed!');
      }
    }
    
    console.log('\n✅ Lobby progression test completed!');
    return results;
  }

  /**
   * Format wei to ETH for display
   */
  formatEther(wei) {
    return (Number(wei) / 1e18).toFixed(4);
  }

  /**
   * Sleep utility for waiting between operations
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const utils = new BlockchainTestUtils();
  const command = process.argv[2];
  const lobbyId = process.argv[3] || '0x845c60c0b23c9dfa602377c055dfdf4d3af95a3ec9b350942c02565af41152ec';

  switch (command) {
    case 'check-connection':
      utils.checkAnvilConnection().then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      });
      break;
      
    case 'check-contract':
      utils.checkContractDeployment().then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      });
      break;
      
    case 'get-lobby':
      utils.getLobbyInfo(lobbyId).then(result => {
        if (result.success) {
          const lobby = result.lobby;
          console.log('📋 Lobby Status Report');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`🆔 Lobby ID: ${lobby.lobbyId}`);
          console.log(`🏠 Host: ${lobby.host}`);
          console.log(`📊 Status: ${lobby.statusName} (${lobby.status})`);
          console.log(`💰 Bet Amount: ${utils.formatEther(lobby.betAmount)} ETH`);
          console.log(`🏆 Total Prize: ${utils.formatEther(lobby.totalPrize)} ETH`);
          console.log(`👤 Winner: ${lobby.winner === '0x0000000000000000000000000000000000000000' ? 'None declared' : lobby.winner}`);
          console.log(`👥 Participants: ${lobby.participantCount || lobby.participants?.length || 'Unknown'}`);
          if (lobby.participants && lobby.participants.length > 0) {
            console.log(`   Players: ${lobby.participants.slice(0, 3).map(p => p.slice(0, 6) + '...').join(', ')}${lobby.participants.length > 3 ? ` +${lobby.participants.length - 3} more` : ''}`);
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          
          // Status-specific info
          switch(lobby.status) {
            case 0: // Created
              console.log('⏳ Waiting for game to start');
              break;
            case 1: // InProgress  
              console.log('🎮 Game is currently running');
              break;
            case 2: // Finished
              console.log('🏁 Game finished! Prize ready to claim');
              break;
            case 3: // Claimed
              console.log('✅ Prize has been claimed');
              break;
          }
        } else {
          console.log('❌ Failed to get lobby info:', result.error);
        }
        process.exit(result.success ? 0 : 1);
      });
      break;

    case 'list-all':
    case 'get-all-lobbies':
      utils.getAllLobbies().then(result => {
        if (result.success) {
          if (result.lobbies.length === 0) {
            console.log('\n📭 No lobbies found on the blockchain');
            console.log('💡 Try creating a lobby in the game first!');
          } else {
            console.log(`\n✅ Successfully scanned ${result.totalFound} lobbies`);
            
            // Show summary by status
            const statusCount = {};
            result.lobbies.forEach(lobby => {
              const status = lobby.statusName;
              statusCount[status] = (statusCount[status] || 0) + 1;
            });
            
            console.log('\n📊 Lobby Summary:');
            Object.entries(statusCount).forEach(([status, count]) => {
              console.log(`   ${status}: ${count} lobbies`);
            });
            
            // Show active lobbies (InProgress or Finished)
            const activeLobbies = result.lobbies.filter(l => l.status === 1 || l.status === 2);
            if (activeLobbies.length > 0) {
              console.log('\n🎮 Active/Finished Lobbies:');
              activeLobbies.forEach(lobby => {
                console.log(`   ${lobby.lobbyId.slice(0, 10)}... - ${lobby.statusName} - ${utils.formatEther(lobby.totalPrize)} ETH prize`);
              });
            }
          }
        } else {
          console.log('❌ Failed to get all lobbies:', result.error);
        }
        process.exit(result.success ? 0 : 1);
      });
      break;
      
    case 'test-progression':
      utils.testLobbyProgression(lobbyId).then(() => {
        process.exit(0);
      }).catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
      });
      break;
      
    default:
      console.log(`
Blockchain Test Utilities for WinModal Testing

Usage: node blockchain-test-utils.js <command> [lobbyId]

Commands:
  check-connection     Check Anvil blockchain connection
  check-contract       Check if Openfront contract is deployed
  get-lobby           Get single lobby information from blockchain
  list-all            Get ALL lobbies from blockchain (scans events)
  get-all-lobbies     Alias for list-all
  test-progression    Run complete lobby state progression test

Examples:
  node blockchain-test-utils.js check-connection
  node blockchain-test-utils.js get-lobby 0x1234...
  node blockchain-test-utils.js list-all
  node blockchain-test-utils.js test-progression 0x1234...
`);
      process.exit(1);
  }
}

export default BlockchainTestUtils;
