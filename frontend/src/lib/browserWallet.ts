import { createWalletClient, custom } from 'viem'
import type { WalletClient } from 'viem'
import { polygon } from 'viem/chains'

import { POLYGON_CHAIN_HEX } from './config'

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export async function connectBrowserWallet(): Promise<{ wallet: WalletClient; address: string }> {
  await ensurePolygonNetwork()
  const provider = window.ethereum
  if (!provider) {
    throw new Error('Install MetaMask to connect a wallet.')
  }
  const wallet = createWalletClient({ chain: polygon, transport: custom(provider) })
  await provider.request({ method: 'eth_requestAccounts' })
  const [address] = await wallet.getAddresses()
  if (!address) {
    throw new Error('No address was found in MetaMask.')
  }
  return { wallet, address }
}

export async function ensurePolygonNetwork() {
  if (!window.ethereum) {
    throw new Error('Install MetaMask to connect a wallet.')
  }

  const chainId = await window.ethereum.request({ method: 'eth_chainId' })
  if (chainId === POLYGON_CHAIN_HEX) {
    return
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_HEX }],
    })
    } catch (error: unknown) {
      if (!isProviderError(error, 4902)) {
        throw error
      }

    await window.ethereum.request({
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
