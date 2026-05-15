import type { TickSize } from '@polymarket/clob-client-v2'
import type { WalletClient } from 'viem'

import { POLYGON_CHAIN_ID, POLYMARKET_CLOB_URL, POLYMARKET_RELAYER_URL } from './config'
import type { WagerDraft, WagerPreview } from './types'

type BrowserWalletClient = WalletClient

export async function getDepositWallet(walletClient: BrowserWalletClient) {
  const { relayer, TransactionType } = await relayerClient(walletClient)
  const address = await relayer.deriveDepositWalletAddress()
  const deployed = await relayer.getDeployed(address, TransactionType.WALLET)
  return { address, deployed }
}

export async function deployDepositWallet(walletClient: BrowserWalletClient) {
  const { relayer } = await relayerClient(walletClient)
  return relayer.deployDepositWallet()
}

export async function signOrPostWalletOrder({
  walletClient,
  walletAddress,
  depositWalletAddress,
  preview,
  draft,
  dryRun,
}: {
  walletClient: BrowserWalletClient
  walletAddress: string
  depositWalletAddress?: string
  preview: WagerPreview
  draft: WagerDraft
  dryRun: boolean
}) {
  const {
    AssetType,
    OrderType,
    Side,
    SignatureTypeV2,
  } = await import('@polymarket/clob-client-v2')
  const useDepositWallet = Boolean(depositWalletAddress)
  const signatureType = useDepositWallet ? SignatureTypeV2.POLY_1271 : SignatureTypeV2.EOA
  const funderAddress = useDepositWallet ? depositWalletAddress : walletAddress
  const clobClient = await authenticatedClobClient(walletClient, signatureType, funderAddress)
  const userOrder = {
    tokenID: preview.tokenId,
    price: Number(preview.price),
    size: Number(preview.size),
    side: draft.side === 'BUY' ? Side.BUY : Side.SELL,
  }
  const options = {
    tickSize: preview.minTickSize as TickSize,
    negRisk: preview.negRisk,
  }

  if (dryRun) {
    return {
      signedOrder: await clobClient.createOrder(userOrder, options),
      exchangeResponse: null,
    }
  }

  await clobClient.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL })
  return {
    signedOrder: null,
    exchangeResponse: await clobClient.createAndPostOrder(userOrder, options, OrderType.GTC),
  }
}

async function authenticatedClobClient(
  walletClient: BrowserWalletClient,
  signatureType: number,
  funderAddress?: string,
) {
  const { ClobClient } = await import('@polymarket/clob-client-v2')
  const bootstrapClient = new ClobClient({
    host: POLYMARKET_CLOB_URL,
    chain: POLYGON_CHAIN_ID,
    signer: walletClient,
    signatureType,
    funderAddress,
  })
  const creds = await bootstrapClient.createOrDeriveApiKey()
  return new ClobClient({
    host: POLYMARKET_CLOB_URL,
    chain: POLYGON_CHAIN_ID,
    signer: walletClient,
    creds,
    signatureType,
    funderAddress,
  })
}

async function relayerClient(walletClient: BrowserWalletClient) {
  const { RelayClient, TransactionType } = await import('@polymarket/builder-relayer-client')
  return {
    relayer: new RelayClient(POLYMARKET_RELAYER_URL, POLYGON_CHAIN_ID, walletClient),
    TransactionType,
  }
}
