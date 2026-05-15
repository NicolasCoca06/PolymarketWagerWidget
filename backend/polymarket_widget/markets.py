from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import HTTPException

from .schemas import MarketSummary
from .settings import settings


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value in (None, ""):
        return []
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return []
        return decoded if isinstance(decoded, list) else []
    return []


def parse_market(raw: dict[str, Any]) -> MarketSummary:
    return MarketSummary(
        id=str(raw.get("id", "")),
        question=raw.get("question", ""),
        description=raw.get("description", ""),
        conditionId=raw.get("conditionId", ""),
        slug=raw.get("slug", ""),
        outcomes=[str(item) for item in _json_list(raw.get("outcomes"))],
        outcomePrices=[str(item) for item in _json_list(raw.get("outcomePrices"))],
        volume=str(raw.get("volume", "0")),
        endDate=raw.get("endDate", ""),
        clobTokenIds=[str(item) for item in _json_list(raw.get("clobTokenIds"))],
        orderPriceMinTickSize=float(raw.get("orderPriceMinTickSize") or 0.01),
        negRisk=bool(raw.get("negRisk", False)),
    )


async def fetch_markets(limit: int = 12, search: str | None = None) -> list[MarketSummary]:
    search_term = search.strip().lower() if search else ""
    page_limit = 100 if search_term else limit
    pages = 5 if search_term else 1
    raw_markets: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        for page in range(pages):
            response = await client.get(
                f"{settings.gamma_api_base}/markets",
                params={
                    "active": "true",
                    "closed": "false",
                    "limit": page_limit,
                    "offset": page * page_limit,
                    "enable_order_book": "true",
                },
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Unable to fetch markets from Polymarket.",
                )

            page_markets = response.json()
            raw_markets.extend(page_markets)
            if len(page_markets) < page_limit:
                break

    markets = [parse_market(raw) for raw in raw_markets]
    if not search_term:
        return markets[:limit]

    return [market for market in markets if _matches(market, search_term)][:limit]


async def fetch_market_by_condition_id(condition_id: str) -> MarketSummary:
    markets = await fetch_markets(limit=100)
    for market in markets:
        if market.conditionId == condition_id:
            return market

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{settings.gamma_api_base}/markets",
            params={"condition_ids": condition_id, "limit": 1},
        )

    if response.status_code == 200:
        raw_markets = response.json()
        if raw_markets:
            return parse_market(raw_markets[0])

    raise HTTPException(status_code=404, detail="Market not found.")


def _matches(market: MarketSummary, search_term: str) -> bool:
    searchable_text = " ".join(
        [
            market.question,
            market.description,
            market.slug,
            *market.outcomes,
        ]
    ).lower()
    return search_term in searchable_text
