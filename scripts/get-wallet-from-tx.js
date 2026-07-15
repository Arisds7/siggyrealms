const { createPublicClient, http, defineChain } = require('viem');

// Define Ritual Testnet chain
const ritualTestnet = defineChain({
  id: 1979,
  name: "Ritual Testnet",
  nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.ritualfoundation.org"] },
  },
});

const GENESIS_EGG_ADDRESS = '0xf2d016B3d8E7e415feccF377981a4EB51F2C829C';

async function getWalletFromTokenId(tokenId) {
  const client = createPublicClient({
    chain: ritualTestnet,
    transport: http(),
  });

  try {
    const owner = await client.readContract({
      address: GENESIS_EGG_ADDRESS,
      abi: [
        {
          "type": "function",
          "name": "ownerOf",
          "inputs": [{ "name": "tokenId", "type": "uint256" }],
          "outputs": [{ "name": "", "type": "address" }],
          "stateMutability": "view"
        }
      ],
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    
    console.log(`Token ID: ${tokenId}`);
    console.log(`Wallet: ${owner}`);
    return owner;
  } catch (error) {
    console.error(`Error fetching owner for token ${tokenId}:`, error.message);
    return null;
  }
}

// Get wallet addresses from token IDs
async function main() {
  console.log('Fetching wallet addresses from token IDs...\n');
  
  await getWalletFromTokenId(1); // Cindrel
  console.log();
  await getWalletFromTokenId(2); // Mossel
}

main();
