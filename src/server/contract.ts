import { createConfig, http, createClient } from '@wagmi/core';
import { hardhat, baseSepolia, localhost } from '@wagmi/core/chains';
import { readContract, writeContract } from '@wagmi/core';
import { parseEther, formatEther, type Hash, keccak256, toHex, createWalletClient, privateKeyToAccount, type Address } from 'viem';

// Contract configuration
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const GAME_SERVER_PRIVATE_KEY = process.env.GAME_SERVER_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Default anvil account

// Local Anvil chain for development
const anvil = {
  ...localhost,
  id: 31337,
  name: 'Anvil',
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public: { http: ['http://127.0.0.1:8545'] },
  },
};

// Contract ABI - matches the Openfront.sol contract
const CONTRACT_ABI = [
  {
    "type": "constructor",
    "inputs": [{ "name": "_gameServer", "type": "address", "internalType": "address" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createLobby",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" },
      { "name": "betAmount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "joinLobby",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "startGame",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "declareWinner",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" },
      { "name": "winner", "type": "address", "internalType": "address" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimPrize",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getLobby",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [
      { "name": "host", "type": "address", "internalType": "address" },
      { "name": "betAmount", "type": "uint256", "internalType": "uint256" },
      { "name": "participants", "type": "address[]", "internalType": "address[]" },
      { "name": "status", "type": "uint8", "internalType": "enum Openfront.GameStatus" },
      { "name": "winner", "type": "address", "internalType": "address" },
      { "name": "totalPrize", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getParticipantCount",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isParticipant",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" },
      { "name": "participant", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setGameServer",
    "inputs": [{ "name": "_gameServer", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "LobbyCreated",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32" },
      { "name": "host", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "betAmount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ParticipantJoined",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32" },
      { "name": "participant", "type": "address", "indexed": true, "internalType": "address" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GameStarted",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GameFinished",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32" },
      { "name": "winner", "type": "address", "indexed": true, "internalType": "address" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PrizeClaimed",
    "inputs": [
      { "name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32" },
      { "name": "winner", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "LobbyNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotHost",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotWinner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotGameServer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBetAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LobbyFull",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GameAlreadyStarted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GameNotFinished",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PrizeAlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotParticipant",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientFunds",
    "inputs": []
  }
] as const;

// Create account from private key for server transactions
const gameServerAccount = privateKeyToAccount(GAME_SERVER_PRIVATE_KEY as `0x${string}`);

// Wagmi config for server-side operations
export const config = createConfig({
  chains: [anvil, hardhat, baseSepolia],
  transports: {
    [anvil.id]: http('http://127.0.0.1:8545'),
    [hardhat.id]: http(),
    [baseSepolia.id]: http()
  }
});

// Wallet client for server transactions
export const walletClient = createWalletClient({
  account: gameServerAccount,
  chain: anvil,
  transport: http('http://127.0.0.1:8545')
});

// Types
export interface LobbyInfo {
  host: Address;
  betAmount: bigint;
  participants: Address[];
  status: GameStatus;
  winner: Address;
  totalPrize: bigint;
}

export enum GameStatus {
  Created = 0,
  InProgress = 1,
  Finished = 2,
  Claimed = 3
}

export interface StartGameParams {
  lobbyId: string;
}

export interface DeclareWinnerParams {
  lobbyId: string;
  winnerAddress: Address;
}

// Utility functions
function stringToBytes32(str: string): `0x${string}` {
  // If the string is already a proper hex string (0x + 64 chars), return it
  if (str.startsWith('0x') && str.length === 66) {
    return str as `0x${string}`;
  }
  
  // Convert string to bytes32 by hashing it
  const hash = keccak256(toHex(str));
  return hash;
}

export function getContractAddress(): Address {
  return CONTRACT_ADDRESS as Address;
}

export function getContractABI() {
  return CONTRACT_ABI;
}

export function getGameServerAddress(): Address {
  return gameServerAccount.address;
}

// Read operations (no gas required)
export async function getLobbyInfo(lobbyId: string): Promise<LobbyInfo | null> {
  try {
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    console.log('Server: Getting lobby info for:', {
      lobbyId,
      lobbyIdBytes32
    });

    const result = await readContract(config, {
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: 'getLobby',
      args: [lobbyIdBytes32]
    }) as [Address, bigint, Address[], number, Address, bigint];

    const [host, betAmount, participants, status, winner, totalPrize] = result;

    // If the host address is the zero address, the lobby doesn't exist
    if (host === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    return {
      host,
      betAmount,
      participants,
      status: status as GameStatus,
      winner,
      totalPrize
    };
  } catch (error) {
    console.error('Error getting lobby info:', error);
    return null;
  }
}

export async function getParticipantCount(lobbyId: string): Promise<number> {
  try {
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    const count = await readContract(config, {
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: 'getParticipantCount',
      args: [lobbyIdBytes32]
    }) as bigint;

    return Number(count);
  } catch (error) {
    console.error('Error getting participant count:', error);
    return 0;
  }
}

export async function isParticipant(lobbyId: string, participantAddress: Address): Promise<boolean> {
  try {
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    const result = await readContract(config, {
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: 'isParticipant',
      args: [lobbyIdBytes32, participantAddress]
    }) as boolean;

    return result;
  } catch (error) {
    console.error('Error checking if participant:', error);
    return false;
  }
}

// Write operations (require gas, only game server can call these)
export async function startGame(params: StartGameParams): Promise<Hash | null> {
  try {
    const { lobbyId } = params;
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    console.log('Server: Starting game for lobby:', {
      lobbyId,
      lobbyIdBytes32,
      gameServerAddress: gameServerAccount.address
    });

    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: 'startGame',
      args: [lobbyIdBytes32],
      account: gameServerAccount,
      chain: anvil
    });

    console.log('Game started successfully, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Error starting game:', error);
    return null;
  }
}

export async function declareWinner(params: DeclareWinnerParams): Promise<Hash | null> {
  try {
    const { lobbyId, winnerAddress } = params;
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    console.log('Server: Declaring winner for lobby:', {
      lobbyId,
      lobbyIdBytes32,
      winnerAddress,
      gameServerAddress: gameServerAccount.address
    });

    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: 'declareWinner',
      args: [lobbyIdBytes32, winnerAddress],
      account: gameServerAccount,
      chain: anvil
    });

    console.log('Winner declared successfully, transaction hash:', hash);
    return hash;
  } catch (error) {
    console.error('Error declaring winner:', error);
    return null;
  }
}

// Utility to check if lobby is on-chain
export async function isLobbyOnChain(lobbyId: string): Promise<boolean> {
  const lobbyInfo = await getLobbyInfo(lobbyId);
  return lobbyInfo !== null;
}

// Export the configuration for use in other server modules if needed
export { config as wagmiConfig, gameServerAccount };