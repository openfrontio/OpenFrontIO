import Privy, { LocalStorage } from '@privy-io/js-sdk-core'
import { createConfig, getAccount, connect, getWalletClient } from '@wagmi/core'
import { injected, walletConnect } from '@wagmi/connectors'
import { http, createWalletClient, custom } from 'viem'
import { baseSepolia, localhost } from 'viem/chains'

// Local Anvil chain for development
const anvil = {
  ...localhost,
  id: 31337,
  name: 'Anvil',
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public: { http: ['http://127.0.0.1:8545'] },
  },
}

// Wagmi Core for external wallets
export const wagmiConfig = createConfig({
  chains: [baseSepolia, anvil],
  transports: {
    [baseSepolia.id]: http(),
    [anvil.id]: http('http://127.0.0.1:8545'),
  },
  connectors: [
    injected({
      target: 'metaMask',
    }), // MetaMask, etc.
    walletConnect({ 
      projectId: process.env.VITE_WALLETCONNECT_PROJECT_ID || '',
      metadata: {
        name: 'OpenFrontIO',
        description: 'OpenFrontIO Game',
        url: 'https://openfront.io',
        icons: ['https://openfront.io/favicon.ico']
      }
    })
  ],
})

// Privy instance
export const privy = new Privy({
  appId: process.env.VITE_PRIVY_APP_ID || '',
  clientId: process.env.VITE_PRIVY_CLIENT_ID || '',
  supportedChains: [baseSepolia, anvil],
  storage: new LocalStorage(),
})

// Get current wallet address if connected
export function getCurrentWalletAddress(): string | undefined {
  const account = getAccount(wagmiConfig)
  return account?.address
}
