import type { MarketSummary, WagerAdvice, WagerDraft, WagerPreview } from './types'

export class WidgetApi {
  private readonly backendUrl: string

  constructor(backendUrl: string) {
    this.backendUrl = backendUrl
  }

  async markets(limit: number, search: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (search.trim().length >= 2) {
      params.set('search', search.trim())
    }
    return this.request<MarketSummary[]>(`/api/markets?${params.toString()}`)
  }

  async previewWager(draft: WagerDraft) {
    return this.request<WagerPreview>('/api/wagers/preview', {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  }

  async adviseWager(draft: WagerDraft) {
    return this.request<WagerAdvice>('/api/wagers/advice', {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.backendUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.detail ?? 'Request failed')
    }
    return response.json() as Promise<T>
  }
}
