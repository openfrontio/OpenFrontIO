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
    injected(), // MetaMask, etc.
    walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID })
  ],
})

// Privy instance
export const privy = new Privy({
  appId: import.meta.env.VITE_PRIVY_APP_ID,
  clientId: import.meta.env.VITE_PRIVY_CLIENT_ID,
  supportedChains: [baseSepolia, anvil],
  storage: new LocalStorage(),
})
