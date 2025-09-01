// Quick test script to verify server can connect to contract
const { testServerConnection } = require('./src/server/contract.ts');

async function main() {
  console.log('Testing server contract connection...');
  
  try {
    const success = await testServerConnection();
    if (success) {
      console.log('✅ Server contract connection test passed');
    } else {
      console.log('❌ Server contract connection test failed');
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

main().catch(console.error);