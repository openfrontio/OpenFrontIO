import { writeContract, readContract, connect, getAccount, watchContractEvent } from '@wagmi/core';
import { parseEther, formatEther, type Hash, keccak256, toHex } from 'viem';
import { injected, metaMask, walletConnect } from '@wagmi/connectors';
import { wagmiConfig as config } from './wallet';

const CONTRACT_ADDRESS = "0xb49F96bb922B077769eAAb517D5B012A42DE3b1D" as const;

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
      { "name": "betAmount", "type": "uint256", "internalType": "uint256" },
      { "name": "isPublic", "type": "bool", "internalType": "bool" }
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
    "name": "WinnerDeclared",
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
  },
  {
    "type": "function",
    "name": "getAllPublicLobbies",
    "inputs": [],
    "outputs": [
      { "name": "", "type": "bytes32[]", "internalType": "bytes32[]" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAllPrivateLobbies",
    "inputs": [],
    "outputs": [
      { "name": "", "type": "bytes32[]", "internalType": "bytes32[]" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPublicLobbyCount",
    "inputs": [],
    "outputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPrivateLobbyCount",
    "inputs": [],
    "outputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  }
] as const;

// Using the shared wagmi config from wallet.ts

export function getContractAddress() {
  return CONTRACT_ADDRESS;
}

export function getContractABI() {
  return CONTRACT_ABI;
}

export interface CreateLobbyParams {
  lobbyId: string;
  betAmount: string;
  lobbyVisibility?: "private" | "public";
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

export interface ClaimPrizeParams {
  lobbyId: string;
}

export interface ClaimPrizeResult {
  hash: Hash;
  lobbyId: string;
  playerAddress: string;
}

export interface StartGameParams {
  lobbyId: string;
}

export interface StartGameResult {
  hash: Hash;
  lobbyId: string;
  playerAddress: string;
}

export async function connectWallet(): Promise<void> {
  try {
    // Try to connect with injected wallet (MetaMask, etc.)
    await connect(config, { 
      connector: injected({
        target: 'metaMask',
      })
    });
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
  
  // Convert string directly to bytes32 by padding with zeros
  // This preserves the original string instead of hashing it
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  
  // bytes32 is 32 bytes, so pad with zeros if needed
  const padded = new Uint8Array(32);
  padded.set(bytes.slice(0, 32)); // Take max 32 bytes
  
  // Convert to hex string
  const hex = Array.from(padded)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `0x${hex}` as `0x${string}`;
}

function bytes32ToString(bytes32: `0x${string}`): string {
  // Remove 0x prefix and convert hex to bytes
  const hex = bytes32.slice(2);
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Find the end of the string (first zero byte)
  let length = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      length = i;
      break;
    }
  }
  
  // Convert back to string
  const decoder = new TextDecoder();
  return decoder.decode(bytes.slice(0, length));
}

export async function createLobby(params: CreateLobbyParams): Promise<CreateLobbyResult> {
  const { lobbyId, betAmount, lobbyVisibility } = params;

  // Check if wallet is connected
  const account = getAccount(config);
  if (!account.isConnected) {
    // Try to connect wallet
    await connectWallet();
  }

  const betAmountWei = parseEther(betAmount);
  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  const isPublic = (lobbyVisibility === "public" ? true : false);

  console.log("Creating lobby with:", {
    lobbyId,
    lobbyIdBytes32,
    betAmount,
    betAmountWei: betAmountWei.toString(),
  });
  console.log("Contract Address:", CONTRACT_ADDRESS);

  const hash = await writeContract(config, {
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "createLobby",
    args: [lobbyIdBytes32, betAmountWei, isPublic],
    value: betAmountWei,
  });

  return {
    hash,
    lobbyId,
    betAmount,
  };
}

export enum GameStatus {
  Created = 0,
  InProgress = 1,
  Finished = 2,
  Claimed = 3
}

export interface LobbyInfo {
  host: string;
  betAmount: bigint;
  participants: string[];
  status: GameStatus;
  winner: string;
  totalPrize: bigint;
  exists: boolean;
}

export interface PublicLobbyInfo {
  lobbyId: string;
  host: string;
  betAmount: bigint;
  participants: string[];
  status: GameStatus;
  winner: string;
  totalPrize: bigint;
  participantCount: number;
  formattedBetAmount: string;
}

export async function getLobbyInfo(lobbyId: string): Promise<LobbyInfo | null> {
  try {
    const lobbyIdBytes32 = stringToBytes32(lobbyId);

    console.log('Getting lobby info from blockchain:', {
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
    const exists = host !== '0x0000000000000000000000000000000000000000';

    const lobbyInfo: LobbyInfo = {
      host,
      betAmount,
      participants,
      status: status as GameStatus,
      winner,
      totalPrize,
      exists
    };

    console.log('Lobby info result:', {
      lobbyId,
      exists,
      host,
      betAmount: formatEther(betAmount),
      participants: participants.length,
      status: GameStatus[status],
      winner: winner === '0x0000000000000000000000000000000000000000' ? 'None' : winner,
      totalPrize: formatEther(totalPrize)
    });

    return lobbyInfo;
  } catch (error) {
    console.error('Error getting lobby info from blockchain:', error);
    return null;
  }
}

export async function isLobbyOnChain(lobbyId: string): Promise<boolean> {
  const lobbyInfo = await getLobbyInfo(lobbyId);
  return lobbyInfo?.exists ?? false;
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

export async function claimPrize(params: ClaimPrizeParams): Promise<ClaimPrizeResult> {
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

  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  
  console.log('Claiming prize for lobby:', {
    lobbyId,
    lobbyIdBytes32,
    playerAddress: account.address
  });

  try {
    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'claimPrize',
      args: [lobbyIdBytes32]
    });

    console.log('Successfully claimed prize, transaction hash:', hash);

    return {
      hash,
      lobbyId,
      playerAddress: account.address!
    };
  } catch (error: any) {
    console.error('Failed to claim prize:', error);
    
    // Handle specific contract errors
    if (error.message.includes('NotWinner')) {
      throw new Error('You are not the winner of this lobby.');
    } else if (error.message.includes('GameNotFinished')) {
      throw new Error('The game has not finished yet.');
    } else if (error.message.includes('PrizeAlreadyClaimed')) {
      throw new Error('Prize has already been claimed.');
    } else if (error.message.includes('User rejected')) {
      throw new Error('Transaction was cancelled by user.');
    } else {
      throw new Error(`Failed to claim prize: ${error.message || 'Unknown error'}`);
    }
  }
}

export interface DeclareWinnerParams {
  lobbyId: string;
  winner: string;
}

export interface DeclareWinnerResult {
  hash: Hash;
  lobbyId: string;
  winnerAddress: string;
}

export async function declareWinner(params: DeclareWinnerParams): Promise<DeclareWinnerResult> {
  const { lobbyId, winner } = params;

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

  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  
  console.log('Declaring winner for lobby:', {
    lobbyId,
    lobbyIdBytes32,
    winner,
    callerAddress: account.address
  });

  try {
    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'declareWinner',
      args: [lobbyIdBytes32, winner as `0x${string}`]
    });

    console.log('Successfully declared winner, transaction hash:', hash);

    return {
      hash,
      lobbyId,
      winnerAddress: winner
    };
  } catch (error: any) {
    console.error('Failed to declare winner:', error);
    
    // Handle specific contract errors
    if (error.message.includes('NotGameServer')) {
      throw new Error('Only the game server can declare winners.');
    } else if (error.message.includes('GameNotInProgress')) {
      throw new Error('Game is not in progress.');
    } else if (error.message.includes('InvalidWinner')) {
      throw new Error('Invalid winner address.');
    } else if (error.message.includes('User rejected')) {
      throw new Error('Transaction was cancelled by user.');
    } else {
      throw new Error(`Failed to declare winner: ${error.message || 'Unknown error'}`);
    }
  }
}

// Event watching functions
export interface ContractEventCallbacks {
  onGameStarted?: (lobbyId: string) => void;
  onWinnerDeclared?: (lobbyId: string, winner: string) => void;
  onPrizeClaimed?: (lobbyId: string, winner: string, amount: bigint) => void;
}

export function watchLobbyEvents(lobbyId: string, callbacks: ContractEventCallbacks) {
  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  const unwatchFunctions: (() => void)[] = [];

  // Watch GameStarted events
  if (callbacks.onGameStarted) {
    const unwatchGameStarted = watchContractEvent(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      eventName: 'GameStarted',
      args: { lobbyId: lobbyIdBytes32 },
      onLogs: (logs) => {
        logs.forEach((log) => {
          console.log('GameStarted event received:', log);
          callbacks.onGameStarted?.(lobbyId);
        });
      }
    });
    unwatchFunctions.push(unwatchGameStarted);
  }

  // Watch WinnerDeclared events
  if (callbacks.onWinnerDeclared) {
    const unwatchWinnerDeclared = watchContractEvent(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      eventName: 'WinnerDeclared',
      args: { lobbyId: lobbyIdBytes32 },
      onLogs: (logs) => {
        logs.forEach((log) => {
          console.log('WinnerDeclared event received:', log);
          const { winner } = log.args as { winner: string };
          callbacks.onWinnerDeclared?.(lobbyId, winner);
        });
      }
    });
    unwatchFunctions.push(unwatchWinnerDeclared);
  }

  // Watch PrizeClaimed events
  if (callbacks.onPrizeClaimed) {
    const unwatchPrizeClaimed = watchContractEvent(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      eventName: 'PrizeClaimed',
      args: { lobbyId: lobbyIdBytes32 },
      onLogs: (logs) => {
        logs.forEach((log) => {
          console.log('PrizeClaimed event received:', log);
          const { winner, amount } = log.args as { winner: string; amount: bigint };
          callbacks.onPrizeClaimed?.(lobbyId, winner, amount);
        });
      }
    });
    unwatchFunctions.push(unwatchPrizeClaimed);
  }

  // Return function to unwatch all events
  return () => {
    unwatchFunctions.forEach(unwatch => unwatch());
  };
}

export async function startGame(params: StartGameParams): Promise<StartGameResult> {
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

  const lobbyIdBytes32 = stringToBytes32(lobbyId);
  
  console.log('Starting game for lobby:', {
    lobbyId,
    lobbyIdBytes32,
    playerAddress: account.address
  });

  try {
    const hash = await writeContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'startGame',
      args: [lobbyIdBytes32]
    });

    console.log('Successfully started game, transaction hash:', hash);

    return {
      hash,
      lobbyId,
      playerAddress: account.address!
    };
  } catch (error: any) {
    console.error('Failed to start game:', error);
    
    // Handle specific contract errors
    if (error.message.includes('NotHost')) {
      throw new Error('Only the host can start the game.');
    } else if (error.message.includes('GameAlreadyStarted')) {
      throw new Error('The game has already started.');
    } else if (error.message.includes('LobbyNotFound')) {
      throw new Error('Lobby does not exist.');
    } else if (error.message.includes('User rejected')) {
      throw new Error('Transaction was cancelled by user.');
    } else {
      throw new Error(`Failed to start game: ${error.message || 'Unknown error'}`);
    }
  }
}

/**
 * Get all public lobby IDs from the contract
 */
export async function getAllPublicLobbies(): Promise<string[]> {
  try {
    const result = await readContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getAllPublicLobbies',
      args: []
    }) as `0x${string}`[];

    // Convert bytes32 array back to original string array
    return result.map(lobbyIdBytes32 => bytes32ToString(lobbyIdBytes32));
  } catch (error) {
    console.error('Error getting public lobbies:', error);
    return [];
  }
}

/**
 * Get detailed information for multiple public lobbies
 */
export async function getPublicLobbyDetails(lobbyIds: string[]): Promise<PublicLobbyInfo[]> {
  const lobbyDetails: PublicLobbyInfo[] = [];
  
  for (const lobbyId of lobbyIds) {
    try {
      const lobbyInfo = await getLobbyInfo(lobbyId);
      
      if (lobbyInfo && lobbyInfo.exists) {
        const publicLobbyInfo: PublicLobbyInfo = {
          lobbyId,
          host: lobbyInfo.host,
          betAmount: lobbyInfo.betAmount,
          participants: lobbyInfo.participants,
          status: lobbyInfo.status,
          winner: lobbyInfo.winner,
          totalPrize: lobbyInfo.totalPrize,
          participantCount: lobbyInfo.participants.length,
          formattedBetAmount: formatEther(lobbyInfo.betAmount)
        };
        
        lobbyDetails.push(publicLobbyInfo);
      }
    } catch (error) {
      console.error(`Error getting details for lobby ${lobbyId}:`, error);
      // Continue with other lobbies even if one fails
    }
  }
  
  return lobbyDetails;
}

/**
 * Get all public lobbies with their details
 */
export async function getAllPublicLobbiesWithDetails(): Promise<PublicLobbyInfo[]> {
  try {
    console.log('Fetching all public lobbies...');
    const lobbyIds = await getAllPublicLobbies();
    
    if (lobbyIds.length === 0) {
      console.log('No public lobbies found');
      return [];
    }
    
    console.log(`Found ${lobbyIds.length} public lobbies, fetching details...`);
    const lobbyDetails = await getPublicLobbyDetails(lobbyIds);
    
    console.log(`Retrieved details for ${lobbyDetails.length} lobbies`);
    return lobbyDetails;
  } catch (error) {
    console.error('Error getting all public lobbies with details:', error);
    return [];
  }
}

/**
 * Get the count of public lobbies
 */
export async function getPublicLobbyCount(): Promise<number> {
  try {
    const result = await readContract(config, {
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getPublicLobbyCount',
      args: []
    }) as bigint;

    return Number(result);
  } catch (error) {
    console.error('Error getting public lobby count:', error);
    return 0;
  }
}
