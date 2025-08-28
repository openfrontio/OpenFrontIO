import { createConfig, http } from '@wagmi/core';
import { hardhat } from '@wagmi/core/chains';
import { writeContract, readContract } from '@wagmi/core';
import { parseEther, formatEther, type Hash } from 'viem';

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

const CONTRACT_ABI = [
  {
    "type": "constructor",
    "inputs": [{"name": "_gameServer", "type": "address", "internalType": "address"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createLobby",
    "inputs": [
      {"name": "lobbyId", "type": "bytes32", "internalType": "bytes32"},
      {"name": "betAmount", "type": "uint256", "internalType": "uint256"}
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getLobby",
    "inputs": [{"name": "lobbyId", "type": "bytes32", "internalType": "bytes32"}],
    "outputs": [
      {"name": "host", "type": "address", "internalType": "address"},
      {"name": "betAmount", "type": "uint256", "internalType": "uint256"},
      {"name": "participants", "type": "address[]", "internalType": "address[]"},
      {"name": "status", "type": "uint8", "internalType": "enum Openfront.GameStatus"},
      {"name": "winner", "type": "address", "internalType": "address"},
      {"name": "totalPrize", "type": "uint256", "internalType": "uint256"}
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "LobbyCreated",
    "inputs": [
      {"name": "lobbyId", "type": "bytes32", "indexed": true, "internalType": "bytes32"},
      {"name": "host", "type": "address", "indexed": true, "internalType": "address"},
      {"name": "betAmount", "type": "uint256", "indexed": false, "internalType": "uint256"}
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

export async function createLobby(params: CreateLobbyParams): Promise<CreateLobbyResult> {
  const { lobbyId, betAmount } = params;
  
  const betAmountWei = parseEther(betAmount);
  
  const hash = await writeContract(config, {
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'createLobby',
    args: [lobbyId as `0x${string}`, betAmountWei],
    value: betAmountWei
  });

  return {
    hash,
    lobbyId,
    betAmount
  };
}

