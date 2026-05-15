export type MarketSummary = {
  id: string
  question: string
  description: string
  conditionId: string
  slug: string
  outcomes: string[]
  outcomePrices: string[]
  volume: string
  endDate: string
  clobTokenIds: string[]
  orderPriceMinTickSize: number
  negRisk: boolean
}

export type WagerPreview = {
  market: MarketSummary
  tokenId: string
  outcome: string
  side: 'BUY' | 'SELL'
  price: string
  size: string
  estimatedCostUsdc: string
  minTickSize: string
  negRisk: boolean
  warnings: string[]
}

export type PlaceWagerResponse = {
  preview: WagerPreview
  dryRun: boolean
  signedOrder: Record<string, unknown> | null
  exchangeResponse: Record<string, unknown> | null
  message: string
}

export type WagerDraft = {
  marketId: string
  outcomeIndex: number
  side: 'BUY' | 'SELL'
  price: string
  size: string
}
