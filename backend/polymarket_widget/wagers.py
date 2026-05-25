from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_DOWN

from fastapi import HTTPException

from .schemas import MarketSummary, OrderSide, WagerPreviewRequest, WagerPreviewResponse


def build_wager_preview(
    market: MarketSummary,
    request: WagerPreviewRequest,
) -> WagerPreviewResponse:
    if len(market.clobTokenIds) <= request.outcomeIndex:
        raise HTTPException(
            status_code=422,
            detail="Selected market does not expose a CLOB token for that outcome.",
        )

    price = _positive_decimal(request.price, "price")
    size = _positive_decimal(request.size, "size")
    if price > Decimal("1"):
        raise HTTPException(status_code=422, detail="price must be between 0 and 1.")

    tick_size = Decimal(str(market.orderPriceMinTickSize or 0.01))
    normalized_price = price.quantize(tick_size, rounding=ROUND_DOWN)
    estimated_cost = normalized_price * size if request.side == OrderSide.buy else Decimal("0")
    normalized_cost = estimated_cost.quantize(Decimal("0.001"), rounding=ROUND_DOWN)

    return WagerPreviewResponse(
        market=market,
        tokenId=market.clobTokenIds[request.outcomeIndex],
        outcome=_outcome_name(market, request.outcomeIndex),
        side=request.side,
        price=str(normalized_price),
        size=str(size),
        estimatedCostUsdc=format(normalized_cost, "f"),
        minTickSize=str(tick_size),
        negRisk=market.negRisk,
        warnings=[
            "Real orders should be signed with the connected wallet in the browser.",
            "Use the Polymarket deposit wallet flow before posting live orders.",
        ],
    )


def _positive_decimal(value: str, field_name: str) -> Decimal:
    try:
        number = Decimal(value)
    except (InvalidOperation, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a number.")

    if number <= 0:
        raise HTTPException(status_code=422, detail=f"{field_name} must be positive.")
    return number


def _outcome_name(market: MarketSummary, outcome_index: int) -> str:
    if len(market.outcomes) > outcome_index:
        return market.outcomes[outcome_index]
    return str(outcome_index)
