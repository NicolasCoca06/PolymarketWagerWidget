from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WalletResponse(BaseModel):
    address: str
    privateKey: str
    warning: str


class MarketSummary(BaseModel):
    id: str
    question: str
    description: str
    conditionId: str
    slug: str
    outcomes: list[str]
    outcomePrices: list[str]
    volume: str
    endDate: str
    clobTokenIds: list[str]
    orderPriceMinTickSize: float
    negRisk: bool


class OrderSide(str, Enum):
    buy = "BUY"
    sell = "SELL"


class WagerPreviewRequest(BaseModel):
    marketId: str = Field(..., description="Polymarket conditionId.")
    outcomeIndex: int = Field(0, ge=0, le=1)
    side: OrderSide = OrderSide.buy
    price: str = Field(..., examples=["0.52"])
    size: str = Field(..., examples=["5"])


class WagerPreviewResponse(BaseModel):
    market: MarketSummary
    tokenId: str
    outcome: str
    side: OrderSide
    price: str
    size: str
    estimatedCostUsdc: str
    minTickSize: str
    negRisk: bool
    warnings: list[str]


class PlaceWagerRequest(WagerPreviewRequest):
    privateKey: str | None = Field(
        default=None,
        description="Demo/test only. Prefer wallet-side signing for production.",
    )
    funderAddress: str | None = None
    signatureType: int = 0
    dryRun: bool = True


class PlaceWagerResponse(BaseModel):
    preview: WagerPreviewResponse
    dryRun: bool
    signedOrder: dict[str, Any] | None = None
    exchangeResponse: dict[str, Any] | None = None
    message: str


class WagerAdviceRequest(WagerPreviewRequest):
    walletBalanceUsdc: str | None = Field(
        default=None,
        description="Optional user balance used to flag bankroll risk.",
    )


class WagerAdviceResponse(BaseModel):
    recommendation: str
    confidence: str
    source: str = "llm"
    summary: str
    signals: list[str]
    risks: list[str]
    nextSteps: list[str]
    disclaimer: str
