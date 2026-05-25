import { useEffect, useMemo, useState } from 'react'
import type { WalletClient } from 'viem'

import { WidgetApi } from '../lib/api'
import { connectBrowserWallet, ensurePolygonNetwork } from '../lib/browserWallet'
import { DEFAULT_BACKEND_URL } from '../lib/config'
import { deployDepositWallet as deployPolymarketDepositWallet, getDepositWallet, signOrPostWalletOrder } from '../lib/polymarket'
import type {
  MarketSummary,
  PlaceWagerResponse,
  WagerAdvice,
  WagerDraft,
  WagerPreview,
} from '../lib/types'

type WidgetStep = 'market' | 'wager' | 'insight' | 'review'

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
  const [depositWalletTouched, setDepositWalletTouched] = useState(false)
  const [status, setStatus] = useState('Loading markets...')
  const [outcomeIndex, setOutcomeIndex] = useState(0)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [price, setPrice] = useState('0.50')
  const [size, setSize] = useState('10')
  const [dryRun, setDryRun] = useState(defaultDryRun)
  const [preview, setPreview] = useState<WagerPreview | null>(null)
  const [advice, setAdvice] = useState<WagerAdvice | null>(null)
  const [orderResult, setOrderResult] = useState<PlaceWagerResponse | null>(null)
  const [technicalResult, setTechnicalResult] = useState<unknown | null>(null)
  const [search, setSearch] = useState('')
  const [activeStep, setActiveStep] = useState<WidgetStep>('market')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
  const liveWalletReady = dryRun || Boolean(depositWalletAddress && depositWalletDeployed)
  const canSubmitWager = Boolean(selectedMarket && preview && walletClient && liveWalletReady)

  async function fetchMarkets(query = search) {
    try {
      setStatus('Loading markets from the Python backend...')
      const data = await api.markets(marketLimit, query)
      setMarkets(data)
      if (data.length === 0) {
        setSelectedMarketId('')
        setPreview(null)
        setAdvice(null)
        setOrderResult(null)
        setTechnicalResult(null)
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
      setDepositWalletTouched(false)
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
      setDepositWalletTouched(true)
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
      setTechnicalResult(response)
      const confirmed = await response.wait()
      setDepositWalletDeployed(Boolean(confirmed))
      setDepositWalletTouched(true)
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
      setOrderResult(null)
      setTechnicalResult(null)
      const wager = await api.previewWager(draft)
      setPreview(wager)
      setActiveStep('review')
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
      setIsSubmitting(true)
      await ensurePolygonNetwork()
      setStatus(dryRun ? 'Preparing MetaMask signature...' : 'Signing and posting from the deposit wallet...')
      const wager = preview ?? await previewWager()
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
      const payload: PlaceWagerResponse = {
        preview: wager,
        dryRun,
        signedOrder: asRecord(result.signedOrder),
        exchangeResponse: asRecord(result.exchangeResponse),
        message: dryRun
          ? 'Order signed with MetaMask. dryRun=true, so it was not posted to Polymarket.'
          : exchangeError
            ? `Polymarket rejected the order: ${exchangeError}`
            : 'Order posted to Polymarket from your connected wallet.',
      }
      setOrderResult(payload)
      setTechnicalResult(null)
      setConfirmOpen(false)
      setActiveStep('review')
      setStatus(payload.message)
      onWagerPlaced?.(payload)
    } catch (error) {
      setStatus(`MetaMask/Polymarket error: ${String(error)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function getAdvice() {
    if (!draft) {
      setStatus('Select a market before asking for AI assistance.')
      return
    }

    try {
      setStatus('AI is reviewing price, volume, cost, and timing signals...')
      const result = await api.adviseWager(draft)
      setAdvice(result)
      setActiveStep('insight')
      setStatus(`AI recommendation: ${result.recommendation}. ${result.summary}`)
    } catch (error) {
      setStatus(`Error getting AI assistance: ${String(error)}`)
    }
  }

  function resetMarketDependentState(nextMarketId?: string) {
    if (nextMarketId) {
      setSelectedMarketId(nextMarketId)
    }
    setPreview(null)
    setAdvice(null)
    setOrderResult(null)
    setTechnicalResult(null)
    setConfirmOpen(false)
  }

  function resetExecutionState() {
    setOrderResult(null)
    setTechnicalResult(null)
    setConfirmOpen(false)
  }

  return (
    <section className="polymarket-widget" aria-label="Polymarket wager widget">
      <header className="widget-header">
        <div>
          <h2>Polymarket wager widget</h2>
          <p className="hero-copy">
            Discover a market, review the risk, and sign with MetaMask.
          </p>
        </div>
        <div className="wallet-panel">
          <button className="primary" onClick={connectWallet}>
            {walletAddress ? 'Wallet connected' : 'Connect MetaMask'}
          </button>
          <p className="wallet-status">
            {shortAddress(walletAddress) || 'No wallet connected'}
          </p>
        </div>
      </header>

      <nav className="widget-tabs" aria-label="Widget sections">
        {(['market', 'wager', 'insight', 'review'] as WidgetStep[]).map((step) => (
          <button
            className={activeStep === step ? 'selected' : ''}
            disabled={!canOpenStep(step, { selectedMarket: Boolean(selectedMarket), preview: Boolean(preview) })}
            key={step}
            onClick={() => setActiveStep(step)}
            type="button"
          >
            {stepLabel(step)}
          </button>
        ))}
      </nav>

      <div className="widget-screen">
        {activeStep === 'market' && (
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
              onChange={(event) => resetMarketDependentState(event.target.value)}
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
                    onClick={() => {
                      setOutcomeIndex(index)
                      resetMarketDependentState()
                    }}
                  >
                    <span>{outcome}</span>
                    <strong>{formatDecimal(selectedMarket.outcomePrices[index])}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="step-actions">
            <button className="primary" onClick={() => setActiveStep('wager')} disabled={!selectedMarket}>
              Continue
            </button>
          </div>
        </article>
        )}

        {activeStep === 'wager' && (
        <article className="panel wager-panel">
          <div className="panel-title">
            <h3>Wager</h3>
            <button onClick={() => setActiveStep('market')}>Change market</button>
          </div>
          <div className="deposit-wallet-box">
            <div className="deposit-wallet-copy">
              <div className={`wallet-state ${depositWalletState(depositWalletTouched, depositWalletAddress, depositWalletDeployed)}`}>
                <span>{depositWalletLabel(depositWalletTouched, depositWalletAddress, depositWalletDeployed)}</span>
              </div>
              <strong>Polymarket deposit wallet</strong>
              <small>{depositWalletMessage(depositWalletTouched, depositWalletAddress, depositWalletDeployed)}</small>
              {depositWalletAddress && <small>{shortAddress(depositWalletAddress)}</small>}
            </div>
            <div className="deposit-actions">
              <button onClick={refreshDepositWallet}>Find wallet</button>
              <button onClick={deployDepositWallet} disabled={depositWalletDeployed === true}>
                {depositWalletDeployed ? 'Already active' : 'Activate wallet'}
              </button>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="side">Side</label>
              <select
                id="side"
                value={side}
                onChange={(event) => {
                  setSide(event.target.value as 'BUY' | 'SELL')
                  resetMarketDependentState()
                }}
              >
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="dry-run">Mode</label>
              <select
                id="dry-run"
                value={dryRun ? 'dry' : 'live'}
                onChange={(event) => {
                  setDryRun(event.target.value === 'dry')
                  resetExecutionState()
                }}
              >
                <option value="dry">Sign without posting</option>
                <option value="live">Post real order</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="price">USDC price</label>
              <input
                id="price"
                type="number"
                step="0.01"
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value)
                  resetMarketDependentState()
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="size">Shares</label>
              <input
                id="size"
                type="number"
                step="1"
                min="1"
                value={size}
                onChange={(event) => {
                  setSize(event.target.value)
                  resetMarketDependentState()
                }}
              />
            </div>
          </div>

          <div className="actions">
            <button onClick={previewWager} disabled={!selectedMarket}>Go to preview</button>
            <button className="primary" onClick={getAdvice} disabled={!selectedMarket}>
              Review with AI
            </button>
          </div>
          <p className="status-label">Status: {status}</p>
        </article>
        )}

        {activeStep === 'insight' && (
        <article className="panel advice-panel">
          <div className="panel-title">
            <h3>AI insight</h3>
            <button onClick={() => setActiveStep('wager')}>Edit wager</button>
          </div>
          {advice ? (
            <div className={`advice-card ${advice.recommendation}`}>
              <div className="advice-headline">
                <span>{advice.recommendation}</span>
                <small>LLM · {advice.confidence} confidence</small>
              </div>
              <p>{advice.summary}</p>
              <details>
                <summary>
                  <span>Signals and risks</span>
                  <i aria-hidden="true" className="summary-chevron" />
                </summary>
                <ul>
                  {[...advice.signals, ...advice.risks].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
              <small>{advice.disclaimer}</small>
            </div>
          ) : (
            <div className="empty-state">
              Review price, volume, timing, and exposure before signing.
            </div>
          )}
          <div className="step-actions two-up">
            <button onClick={getAdvice} disabled={!selectedMarket}>
              {advice ? 'Refresh insight' : 'Analyze wager'}
            </button>
            <button className="primary" onClick={previewWager} disabled={!selectedMarket}>
              Continue to review
            </button>
          </div>
        </article>
        )}

        {activeStep === 'review' && (
        <article className="panel result-panel">
          <div className="panel-title">
            <h3>Review</h3>
            <button onClick={() => setActiveStep('wager')}>Edit wager</button>
          </div>
          {preview && (
            <div className="preview-box">
              <div>
                <span>{preview.side} {preview.outcome}</span>
                <strong>{formatMoney(preview.estimatedCostUsdc)} USDC</strong>
              </div>
              <dl className="result-metrics">
                <div>
                  <dt>Price</dt>
                  <dd>{formatDecimal(preview.price)}</dd>
                </div>
                <div>
                  <dt>Shares</dt>
                  <dd>{formatDecimal(preview.size)}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{dryRun ? 'Dry run' : 'Live'}</dd>
                </div>
              </dl>
              <small>Token {shortToken(preview.tokenId)}</small>
            </div>
          )}
          {orderResult || technicalResult ? (
            <div className={`readable-result ${resultTone(orderResult)}`}>
              {orderResult && (
                <>
                  <div className="result-heading">
                    <strong>{resultTitle(orderResult)}</strong>
                    <span>{resultBadge(orderResult)}</span>
                  </div>
                  <p>{orderResult.message}</p>
                  <dl className="result-metrics">
                    <div>
                      <dt>Market</dt>
                      <dd>{orderResult.preview.market.question}</dd>
                    </div>
                    <div>
                      <dt>Outcome</dt>
                      <dd>{orderResult.preview.outcome}</dd>
                    </div>
                    <div>
                      <dt>Cost</dt>
                      <dd>{formatMoney(orderResult.preview.estimatedCostUsdc)} USDC</dd>
                    </div>
                  </dl>
                </>
              )}
              {Boolean(technicalResult) && <p>Deposit wallet transaction submitted.</p>}
            </div>
          ) : null}
          {!canSubmitWager && (
            <div className="requirement-box">
              <strong>{reviewRequirementTitle({ walletClient, preview, dryRun, liveWalletReady })}</strong>
              <small>{reviewRequirementCopy({ walletClient, preview, dryRun, liveWalletReady })}</small>
              {!walletClient && (
                <button onClick={connectWallet}>Connect MetaMask</button>
              )}
              {!dryRun && walletClient && !liveWalletReady && (
                <div className="deposit-actions">
                  <button onClick={refreshDepositWallet}>Find wallet</button>
                  <button onClick={deployDepositWallet} disabled={depositWalletDeployed === true}>
                    {depositWalletDeployed ? 'Already active' : 'Activate wallet'}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="step-actions two-up">
            <button onClick={() => setActiveStep('insight')}>Back to insight</button>
            <button className="primary" onClick={() => setConfirmOpen(true)} disabled={!canSubmitWager}>
              {dryRun ? 'Sign preview' : 'Place wager'}
            </button>
          </div>
          <p className="status-label">Status: {status}</p>
        </article>
        )}
      </div>
      {confirmOpen && preview && (
        <div className="confirm-backdrop" role="presentation">
          <div
            aria-labelledby="confirm-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div>
              <span className="confirm-kicker">
                {dryRun ? 'Signature confirmation' : 'Final confirmation'}
              </span>
              <h3 id="confirm-title">{dryRun ? 'Sign this preview?' : 'Place this wager?'}</h3>
              <p>
                {dryRun
                  ? 'MetaMask will ask you to sign. Nothing will be posted to Polymarket.'
                  : 'This can post a real order to Polymarket from your connected wallet.'}
              </p>
            </div>

            <dl className="result-metrics">
              <div>
                <dt>Outcome</dt>
                <dd>{preview.outcome}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{formatMoney(preview.estimatedCostUsdc)} USDC</dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{formatDecimal(preview.price)}</dd>
              </div>
            </dl>

            <div className="confirm-actions">
              <button onClick={() => setConfirmOpen(false)} disabled={isSubmitting}>
                Cancel
              </button>
              <button className="primary" onClick={placeBet} disabled={isSubmitting}>
                {isSubmitting ? 'Waiting for wallet...' : dryRun ? 'Confirm signature' : 'Confirm wager'}
              </button>
            </div>
          </div>
        </div>
      )}
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

function resultTitle(result: PlaceWagerResponse) {
  if (result.dryRun) {
    return 'Preview signed'
  }
  return exchangeErrorMessage(result.exchangeResponse) ? 'Wager rejected' : 'Wager placed'
}

function resultBadge(result: PlaceWagerResponse) {
  if (result.dryRun) {
    return 'Signed'
  }
  return exchangeErrorMessage(result.exchangeResponse) ? 'Rejected' : 'Posted'
}

function resultTone(result: PlaceWagerResponse | null) {
  if (!result) {
    return ''
  }
  if (result.dryRun) {
    return 'signed'
  }
  return exchangeErrorMessage(result.exchangeResponse) ? 'rejected' : 'posted'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function shortAddress(address: string) {
  if (!address) {
    return ''
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function depositWalletState(touched: boolean, address: string, deployed: boolean | null) {
  if (!touched) {
    return 'idle'
  }
  if (!address) {
    return 'idle'
  }
  return deployed ? 'active' : 'needs-activation'
}

function depositWalletLabel(touched: boolean, address: string, deployed: boolean | null) {
  const state = depositWalletState(touched, address, deployed)
  if (state === 'active') {
    return 'Active'
  }
  if (state === 'needs-activation') {
    return 'Found'
  }
  return 'Not checked'
}

function depositWalletMessage(touched: boolean, address: string, deployed: boolean | null) {
  const state = depositWalletState(touched, address, deployed)
  if (state === 'active') {
    return 'Your deposit wallet is active and ready for live orders.'
  }
  if (state === 'needs-activation') {
    return 'Wallet found, but it still needs activation before posting live orders.'
  }
  return 'Find checks the wallet. Activate creates it only if live trading needs it.'
}

function reviewRequirementTitle({
  walletClient,
  preview,
  dryRun,
  liveWalletReady,
}: {
  walletClient: WalletClient | null
  preview: WagerPreview | null
  dryRun: boolean
  liveWalletReady: boolean
}) {
  if (!preview) {
    return 'Preview required'
  }
  if (!walletClient) {
    return 'Wallet required'
  }
  if (!dryRun && !liveWalletReady) {
    return 'Deposit wallet required'
  }
  return 'Ready'
}

function reviewRequirementCopy({
  walletClient,
  preview,
  dryRun,
  liveWalletReady,
}: {
  walletClient: WalletClient | null
  preview: WagerPreview | null
  dryRun: boolean
  liveWalletReady: boolean
}) {
  if (!preview) {
    return 'Create a readable wager preview before signing.'
  }
  if (!walletClient) {
    return 'Connect MetaMask so the order can be signed from your wallet.'
  }
  if (!dryRun && !liveWalletReady) {
    return 'Live orders need a prepared Polymarket deposit wallet before posting.'
  }
  return 'All signing requirements are complete.'
}

function shortToken(token: string) {
  if (token.length <= 14) {
    return token
  }
  return `${token.slice(0, 8)}...${token.slice(-6)}`
}

function formatMoney(value: string | number) {
  return formatDecimal(value, 3)
}

function formatDecimal(value: string | number | undefined, digits = 3) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return '-'
  }
  return number.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function stepLabel(step: WidgetStep) {
  const labels: Record<WidgetStep, string> = {
    market: 'Market',
    wager: 'Wager',
    insight: 'Insight',
    review: 'Review',
  }
  return labels[step]
}

function canOpenStep(
  step: WidgetStep,
  state: { selectedMarket: boolean; preview: boolean },
) {
  if (step === 'wager' || step === 'insight') {
    return state.selectedMarket
  }
  if (step === 'review') {
    return state.preview
  }
  return true
}
