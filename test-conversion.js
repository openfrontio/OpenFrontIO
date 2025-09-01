// Test stringToBytes32 conversion
function stringToBytes32(str) {
  // If the string is already a proper hex string (0x + 64 chars), return it
  if (str.startsWith('0x') && str.length === 66) {
    return str;
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
  
  return `0x${hex}`;
}

// Test the lobbies from your Anvil output
const lobbies = ['Isq5nTvZ', 'ZzHatYAo', 'GsjqX3iA'];

lobbies.forEach(lobbyId => {
  const bytes32 = stringToBytes32(lobbyId);
  console.log(`${lobbyId} -> ${bytes32}`);
});

// The expected values from your CLI output should be:
// Isq5nTvZ -> 0x497371356e54765a0000000000000000000000000000000000000000000000
// ZzHatYAo -> 0x5a7a48617459416f000000000000000000000000000000000000000000000000