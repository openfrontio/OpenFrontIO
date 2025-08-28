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
    "type": "function",
    "name": "joinLobby",
    "inputs": [{ "name": "lobbyId", "type": "bytes32", "internalType": "bytes32" }],
    "outputs": [],
    "stateMutability": "payable"
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
    "type": "error",
    "name": "InvalidBetAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientFunds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GameAlreadyStarted",
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

export interface JoinLobbyParams {
  lobbyId: string;
}

export interface JoinLobbyResult {
  hash: Hash;
  lobbyId: string;
  playerAddress: string;
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

export async function isLobbyOnChain(lobbyId: string): Promise<boolean> {
  try {
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    console.log('Checking lobby on-chain:', {
      lobbyId,
      lobbyIdBytes32
    });

    const result = await readContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getLobby',
      args: [lobbyIdBytes32]
    }) as [string, bigint, string[], number, string, bigint];

    const [host, betAmount, participants, status, winner, totalPrize] = result;

    // If the host address is the zero address (0x0000...), the lobby doesn't exist
    const isDeployed = host !== '0x0000000000000000000000000000000000000000';

    console.log('Lobby check result:', {
      lobbyId,
      isDeployed,
      host,
      betAmount: betAmount.toString(),
      participants,
      status,
      winner,
      totalPrize: totalPrize.toString()
    });

    return isDeployed;
  } catch (error) {
    console.error('Error checking lobby on-chain:', error);
    // If there's an error (like lobby doesn't exist), return false
    return false;
  }
}

export async function joinLobby(params: JoinLobbyParams): Promise<JoinLobbyResult> {
  const { lobbyId } = params;

  // Check if wallet is connected
  const account = getAccount(config);
  if (!account.isConnected || !account.address) {
    // Try to connect wallet
    await connectWallet();
    // Get account again after connection
    const newAccount = getAccount(config);
    if (!newAccount.isConnected || !newAccount.address) {
      throw new Error('Wallet connection failed');
    }
  }

  // First, get the lobby information to know the required bet amount
  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  
  const lobbyInfo = await readContract(config, {
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getLobby',
    args: [lobbyIdBytes32]
  }) as [string, bigint, string[], number, string, bigint];

  const [host, betAmount, participants, status, winner, totalPrize] = lobbyInfo;

  // Check if lobby exists
  if (host === '0x0000000000000000000000000000000000000000') {
    throw new Error('Lobby does not exist on-chain');
  }

  // Check if user is already a participant (client-side check for better UX)
  const currentAccount = getAccount(config);
  const userAddress = currentAccount.address!.toLowerCase();
  const isAlreadyParticipant = participants.some(p => p.toLowerCase() === userAddress);
  
  if (isAlreadyParticipant) {
    throw new Error('You are already a participant in this lobby');
  }

  // Check if game has already started (status 0 = Created, 1 = InProgress, etc.)
  if (status !== 0) {
    throw new Error('This lobby has already started or finished');
  }

  console.log('Joining lobby with:', {
    lobbyId,
    lobbyIdBytes32,
    betAmount: formatEther(betAmount) + ' ETH',
    requiredPayment: betAmount.toString() + ' wei',
    currentParticipants: participants.length
  });

  try {
    // Call the joinLobby function with the required bet amount as payment
    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'joinLobby',
      args: [lobbyIdBytes32],
      value: betAmount // Pay the exact bet amount required by the lobby
    });

    console.log('Successfully joined lobby, transaction hash:', hash);

    return {
      hash,
      lobbyId,
      playerAddress: currentAccount.address!
    };
  } catch (error: any) {
    console.error('Failed to join lobby:', error);
    
    // Handle specific contract errors
    if (error.message.includes('InsufficientFunds')) {
      throw new Error(`Insufficient funds. You need to pay exactly ${formatEther(betAmount)} ETH to join this lobby.`);
    } else if (error.message.includes('GameAlreadyStarted')) {
      throw new Error('This lobby has already started. You cannot join now.');
    } else if (error.message.includes('User rejected')) {
      throw new Error('Transaction was cancelled by user.');
    } else {
      throw new Error(`Failed to join lobby: ${error.message || 'Unknown error'}`);
    }
  }
}

