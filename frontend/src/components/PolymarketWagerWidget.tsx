import { useEffect, useMemo, useState } from 'react'
import type { WalletClient } from 'viem'

import { WidgetApi } from '../lib/api'
import { connectBrowserWallet, ensurePolygonNetwork } from '../lib/browserWallet'
import { DEFAULT_BACKEND_URL } from '../lib/config'
import { stringifyResult } from '../lib/json'
import { deployDepositWallet as deployPolymarketDepositWallet, getDepositWallet, signOrPostWalletOrder } from '../lib/polymarket'
import type {
  MarketSummary,
  PlaceWagerResponse,
  WagerDraft,
  WagerPreview,
} from '../lib/types'

export type PolymarketWagerWidgetProps = {
  backendUrl?: string
  initialMarketId?: string
  defaultDryRun?: boolean
  marketLimit?: number
  onPreviewCreated?: (preview: WagerPreview) => void
  onWagerPlaced?: (result: PlaceWagerResponse) => void
}

export function PolymarketWagerWidget({
  backendUrl = DEFAULT_BACKEND_URL,
  initialMarketId = '',
  defaultDryRun = true,
  marketLimit = 20,
  onPreviewCreated,
  onWagerPlaced,
}: PolymarketWagerWidgetProps) {
  const api = useMemo(() => new WidgetApi(backendUrl), [backendUrl])
  const [markets, setMarkets] = useState<MarketSummary[]>([])
  const [selectedMarketId, setSelectedMarketId] = useState(initialMarketId)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)
  const [depositWalletAddress, setDepositWalletAddress] = useState('')
  const [depositWalletDeployed, setDepositWalletDeployed] = useState<boolean | null>(null)
  const [status, setStatus] = useState('Loading markets...')
  const [outcomeIndex, setOutcomeIndex] = useState(0)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [price, setPrice] = useState('0.50')
  const [size, setSize] = useState('10')
  const [dryRun, setDryRun] = useState(defaultDryRun)
  const [preview, setPreview] = useState<WagerPreview | null>(null)
  const [orderResult, setOrderResult] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    void fetchMarkets()
    // Initial load only; follow-up searches are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedMarket = useMemo(
    () => markets.find((market) => market.conditionId === selectedMarketId),
    [markets, selectedMarketId],
  )
  const draft: WagerDraft | null = selectedMarket
    ? {
        marketId: selectedMarket.conditionId,
        outcomeIndex,
        side,
        price,
        size,
      }
    : null

  async function fetchMarkets(query = search) {
    try {
      setStatus('Loading markets from the Python backend...')
      const data = await api.markets(marketLimit, query)
      setMarkets(data)
      if (data.length === 0) {
        setSelectedMarketId('')
        setPreview(null)
        setStatus(`No markets found for "${query.trim()}". Try a broader search.`)
        return
      }
      if (!selectedMarketId) {
        setSelectedMarketId(data[0].conditionId)
      }
      setStatus('Select a market and build the wager.')
    } catch (error) {
      setStatus(`Error loading markets: ${String(error)}`)
    }
  }

  async function connectWallet() {
    try {
      const { wallet, address } = await connectBrowserWallet()
      setWalletAddress(address)
      setWalletClient(wallet)
      setDepositWalletAddress('')
      setDepositWalletDeployed(null)
      setStatus('Real wallet connected. Signing happens in MetaMask; your private key never leaves the browser.')
    } catch (error) {
      setStatus(`Error connecting MetaMask: ${String(error)}`)
    }
  }

  async function refreshDepositWallet() {
    if (!walletClient) {
      setStatus('Connect MetaMask before preparing the deposit wallet.')
      return null
    }

    try {
      await ensurePolygonNetwork()
      const wallet = await getDepositWallet(walletClient)
      setDepositWalletAddress(wallet.address)
      setDepositWalletDeployed(wallet.deployed)
      setStatus(
        wallet.deployed
          ? 'Deposit wallet found. Use it as the maker for real orders.'
          : 'Deposit wallet derived, but it is not deployed yet.',
      )
      return wallet
    } catch (error) {
      setStatus(`Error preparing deposit wallet: ${String(error)}`)
      return null
    }
  }

  async function deployDepositWallet() {
    if (!walletClient) {
      setStatus('Connect MetaMask before deploying the deposit wallet.')
      return
    }
    const wallet = await refreshDepositWallet()
    if (!wallet || wallet.deployed) {
      return
    }

    try {
      setStatus('Submitting deposit wallet creation to the relayer...')
      const response = await deployPolymarketDepositWallet(walletClient)
      setOrderResult(stringifyResult(response))
      const confirmed = await response.wait()
      setDepositWalletDeployed(Boolean(confirmed))
      setStatus(
        confirmed
          ? 'Deposit wallet deployed. It now needs funding/allowances before trading.'
          : 'Deposit wallet deployment has not been confirmed yet.',
      )
    } catch (error) {
      setStatus(`The relayer could not deploy the deposit wallet: ${String(error)}`)
    }
  }

  async function previewWager() {
    if (!draft) {
      setStatus('Select a market before creating the wager.')
      return null
    }

    try {
      setOrderResult('')
      const wager = await api.previewWager(draft)
      setPreview(wager)
      setStatus('Wager prepared by the Python backend.')
      onPreviewCreated?.(wager)
      return wager
    } catch (error) {
      setStatus(`Error preparing wager: ${String(error)}`)
      return null
    }
  }

  async function placeBet() {
    if (!draft) {
      setStatus('Select a market before signing.')
      return
    }
    if (!walletClient) {
      setStatus('Connect MetaMask to sign without exposing private keys.')
      return
    }
    if (!dryRun && (!depositWalletAddress || !depositWalletDeployed)) {
      setStatus('To post a real order, prepare/deploy the Polymarket deposit wallet first.')
      return
    }

    try {
      await ensurePolygonNetwork()
      setStatus(dryRun ? 'Preparing MetaMask signature...' : 'Signing and posting from the deposit wallet...')
      const wager = await previewWager()
      if (!wager) {
        return
      }

      const result = await signOrPostWalletOrder({
        walletClient,
        walletAddress,
        depositWalletAddress: depositWalletDeployed ? depositWalletAddress : undefined,
        preview: wager,
        draft,
        dryRun,
      })
      const exchangeError = exchangeErrorMessage(result.exchangeResponse)
      const payload = {
        preview: wager,
        dryRun,
        signedOrder: result.signedOrder,
        exchangeResponse: result.exchangeResponse,
        message: dryRun
          ? 'Order signed with MetaMask. dryRun=true, so it was not posted to Polymarket.'
          : exchangeError
            ? `Polymarket rejected the order: ${exchangeError}`
            : 'Order posted to Polymarket from your connected wallet.',
      }
      setOrderResult(stringifyResult(payload))
      setStatus(payload.message)
      onWagerPlaced?.(payload)
    } catch (error) {
      setStatus(`MetaMask/Polymarket error: ${String(error)}`)
    }
  }

  return (
    <section className="polymarket-widget" aria-label="Polymarket wager widget">
      <header className="widget-header">
        <div>
          <h2>Polymarket wager widget</h2>
          <p className="hero-copy">
            A small, explicit, auditable flow for discovering markets, building wagers, and signing
            with real wallets without custodying keys.
          </p>
        </div>
        <div className="wallet-panel">
          <button className="primary" onClick={connectWallet}>Connect real wallet</button>
          <p className="wallet-status">
            <strong>Wallet:</strong> {walletAddress || 'not connected'}
          </p>
        </div>
      </header>

      <div className="widget-grid">
        <article className="panel market-panel">
          <div className="panel-title">
            <h3>Market</h3>
            <button onClick={() => fetchMarkets()}>Refresh</button>
          </div>

          <div className="field search-row">
            <label htmlFor="search">Search market</label>
            <div>
              <input
                id="search"
                value={search}
                placeholder="e.g. election, bitcoin, fed"
                onChange={(event) => setSearch(event.target.value)}
              />
              <button onClick={() => fetchMarkets()}>Search</button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="market">Active market</label>
            <select
              id="market"
              value={selectedMarket?.conditionId ?? ''}
              onChange={(event) => {
                setSelectedMarketId(event.target.value)
                setPreview(null)
              }}
            >
              {markets.map((market) => (
                <option key={market.conditionId} value={market.conditionId}>
                  {market.question}
                </option>
              ))}
            </select>
          </div>

          {markets.length === 0 && (
            <div className="empty-state">
              No markets to show. Try a broader search.
            </div>
          )}

          {selectedMarket && (
            <div className="market-summary">
              <details>
                <summary>
                  <span>Bet summary</span>
                  <strong>{selectedMarket.question}</strong>
                  <i aria-hidden="true" className="summary-chevron" />
                </summary>
                <p>{selectedMarket.description || 'No description.'}</p>
              </details>
              <div className="outcomes">
                {selectedMarket.outcomes.map((outcome, index) => (
                  <button
                    className={outcomeIndex === index ? 'selected' : ''}
                    key={`${outcome}-${index}`}
                    onClick={() => setOutcomeIndex(index)}
                  >
                    {outcome}: {selectedMarket.outcomePrices[index] ?? '-'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </article>

        <article className="panel">
          <h3>Wager</h3>
          <div className="deposit-wallet-box">
            <div>
              <strong>Deposit wallet</strong>
              <small>
                {depositWalletAddress || 'Not derived yet'}
                {depositWalletAddress && (
                  <>
                    <br />
                    Status: {depositWalletDeployed ? 'deployed' : 'not deployed'}
                  </>
                )}
              </small>
            </div>
            <div className="deposit-actions">
              <button onClick={refreshDepositWallet}>Prepare</button>
              <button onClick={deployDepositWallet}>Deploy</button>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="side">Side</label>
              <select id="side" value={side} onChange={(event) => setSide(event.target.value as 'BUY' | 'SELL')}>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="dry-run">Mode</label>
              <select
                id="dry-run"
                value={dryRun ? 'dry' : 'live'}
                onChange={(event) => setDryRun(event.target.value === 'dry')}
              >
                <option value="dry">Sign without posting</option>
                <option value="live">Post real order</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="price">USDC price</label>
              <input id="price" type="number" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="size">Shares</label>
              <input id="size" type="number" step="1" min="1" value={size} onChange={(event) => setSize(event.target.value)} />
            </div>
          </div>

          <div className="actions">
            <button onClick={previewWager}>Preview</button>
            <button className="primary" onClick={placeBet} disabled={!selectedMarket}>
              Sign with wallet
            </button>
          </div>
          <p className="status-label">Status: {status}</p>
        </article>

        <article className="panel result-panel">
          <h3>Result</h3>
          {preview && (
            <div className="preview-box">
              <span>{preview.outcome}</span>
              <strong>{preview.estimatedCostUsdc} USDC</strong>
              <small>Token {preview.tokenId}</small>
            </div>
          )}
          {orderResult ? (
            <pre>{orderResult}</pre>
          ) : (
            <p>The preview, signed order, or exchange response will appear here.</p>
          )}
        </article>
      </div>
    </section>
  )
}

function exchangeErrorMessage(exchangeResponse: unknown) {
  if (!exchangeResponse || typeof exchangeResponse !== 'object') {
    return ''
  }
  if ('error' in exchangeResponse) {
    return String((exchangeResponse as { error?: unknown }).error)
  }
  if ('errorMsg' in exchangeResponse) {
    return String((exchangeResponse as { errorMsg?: unknown }).errorMsg)
  }
  return ''
}
