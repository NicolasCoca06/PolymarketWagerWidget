import { createWalletClient, custom, getAddress } from 'viem'
import type { WalletClient } from 'viem'
import { polygon } from 'viem/chains'

import { POLYGON_CHAIN_HEX } from './config'

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

type EthereumProvider = {
  isMetaMask?: boolean
  providers?: EthereumProvider[]
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export async function connectBrowserWallet(): Promise<{ wallet: WalletClient; address: string }> {
  const provider = getMetaMaskProvider()
  if (!provider) {
    throw new Error('Install MetaMask to connect a wallet.')
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  const [address] = Array.isArray(accounts) ? accounts : []
  if (typeof address !== 'string') {
    throw new Error('No address was found in MetaMask.')
  }

  await ensurePolygonNetwork(provider)
  const checksummedAddress = getAddress(address)
  const wallet = createWalletClient({
    account: checksummedAddress,
    chain: polygon,
    transport: custom(provider),
  })
  return { wallet, address: checksummedAddress }
}

export async function ensurePolygonNetwork(provider = getMetaMaskProvider()) {
  if (!provider) {
    throw new Error('Install MetaMask to connect a wallet.')
  }

  const chainId = await provider.request({ method: 'eth_chainId' })
  if (chainId === POLYGON_CHAIN_HEX) {
    return
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_HEX }],
    })
  } catch (error: unknown) {
    if (!isProviderError(error, 4902)) {
      throw error
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: POLYGON_CHAIN_HEX,
          chainName: 'Polygon',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: ['https://polygon-rpc.com'],
          blockExplorerUrls: ['https://polygonscan.com'],
        },
      ],
    })
  }
}

function isProviderError(error: unknown, code: number) {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
  )
}

function getMetaMaskProvider() {
  const provider = window.ethereum
  if (!provider) {
    return undefined
  }

  if (provider.providers?.length) {
    return provider.providers.find((item) => item.isMetaMask) ?? provider.providers[0]
  }

  return provider
}
