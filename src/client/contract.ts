import { createConfig, http } from '@wagmi/core';
import { hardhat } from '@wagmi/core/chains';
import { writeContract, readContract, connect, getAccount } from '@wagmi/core';
import { parseEther, formatEther, type Hash, keccak256, toHex } from 'viem';
import { injected, metaMask, walletConnect } from '@wagmi/connectors';

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

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
    "type": "error",
    "name": "InvalidBetAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientFunds",
    "inputs": []
  }
] as const;

export const config = createConfig({
  chains: [hardhat],
  connectors: [
    injected(),
    metaMask(),
    walletConnect({
      projectId: '257f8ca2cb2a54afdd340e54c8966a02'
    }),
  ],
  transports: {
    [hardhat.id]: http()
  }
});

export function getContractAddress() {
  return CONTRACT_ADDRESS;
}

export function getContractABI() {
  return CONTRACT_ABI;
}

export interface CreateLobbyParams {
  lobbyId: string;
  betAmount: string;
}

export interface CreateLobbyResult {
  hash: Hash;
  lobbyId: string;
  betAmount: string;
}

export async function connectWallet(): Promise<void> {
  try {
    // Try to connect with injected wallet (MetaMask, etc.)
    await connect(config, { connector: injected() });
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    throw new Error('Please connect your wallet to continue');
  }
}

function stringToBytes32(str: string): `0x${string}` {
  // If the string is already a proper hex string (0x + 64 chars), return it
  if (str.startsWith('0x') && str.length === 66) {
    return str as `0x${string}`;
  }
  
  // Convert string to bytes32 by hashing it
  const hash = keccak256(toHex(str));
  return hash;
}

export async function createLobby(params: CreateLobbyParams): Promise<CreateLobbyResult> {
  const { lobbyId, betAmount } = params;

  // Check if wallet is connected
  const account = getAccount(config);
  if (!account.isConnected) {
    // Try to connect wallet
    await connectWallet();
  }

  const betAmountWei = parseEther(betAmount);
  const lobbyIdBytes32 = stringToBytes32(lobbyId);

  console.log('Creating lobby with:', {
    lobbyId,
    lobbyIdBytes32,
    betAmount,
    betAmountWei: betAmountWei.toString()
  });

  const hash = await writeContract(config, {
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'createLobby',
    args: [lobbyIdBytes32, betAmountWei],
    value: betAmountWei
  });

  return {
    hash,
    lobbyId,
    betAmount
  };
}

