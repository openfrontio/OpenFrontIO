// Quick test for declareWinner without playing a full game
import { declareWinner, testServerConnection, createLobby } from './src/server/contract';

async function quickTest() {
  console.log('🚀 Starting quick declareWinner test...');
  
  // First test basic connection
  console.log('\n1. Testing server connection...');
  const connectionOk = await testServerConnection();
  if (!connectionOk) {
    console.error('❌ Server connection failed');
    return;
  }
  
  // Test declareWinner with an actual lobby that exists on-chain
  const testLobbyId = 'ZzHatYAo'; // This lobby should exist on contract
  const testWinnerAddress = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'; // Anvil account #0
  
  console.log('\n2. Testing if lobby exists on new contract...');
  // First let's check what lobbies exist
  const { getAllPublicLobbies } = await import('./src/client/contract');
  const publicLobbies = await getAllPublicLobbies();
  console.log('Public lobbies on new contract:', publicLobbies);
  
  console.log('\n3. Testing declareWinner directly...');
  console.log('Test lobby ID:', testLobbyId);
  console.log('Test winner address:', testWinnerAddress);
  
  try {
    const result = await declareWinner({
      lobbyId: testLobbyId,
      winnerAddress: testWinnerAddress as `0x${string}`
    });
    
    if (result) {
      console.log('✅ declareWinner succeeded! Transaction hash:', result);
    } else {
      console.log('❌ declareWinner returned null - check logs above');
    }
  } catch (error) {
    console.error('❌ declareWinner threw error:', error);
  }
}

quickTest().catch(console.error);