from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import HTTPException

from .prompts import GEMINI_ADVICE_INSTRUCTIONS
from .schemas import MarketSummary, WagerAdviceRequest, WagerAdviceResponse
from .settings import settings
from .wagers import build_wager_preview


async def build_wager_advice(
    market: MarketSummary,
    request: WagerAdviceRequest,
) -> WagerAdviceResponse:
    context = _advice_context(market, request)

    try:
        return await _gemini_advice(context)
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=_gemini_error_detail(error))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini response could not be parsed: {error}",
        )
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini request failed: {error}",
        )


def _advice_context(market: MarketSummary, request: WagerAdviceRequest) -> dict[str, Any]:
    preview = build_wager_preview(market, request)
    market_price = _decimal_at(market.outcomePrices, request.outcomeIndex)
    wager_price = _decimal(preview.price)
    estimated_cost = _decimal(preview.estimatedCostUsdc)
    volume = _decimal(market.volume)
    edge = market_price - wager_price
    days_left = _days_until(market.endDate)

    return {
        "marketQuestion": market.question,
        "marketDescription": market.description,
        "outcome": preview.outcome,
        "side": preview.side.value if hasattr(preview.side, "value") else str(preview.side),
        "marketImpliedProbability": _percent(market_price),
        "userLimitPrice": _percent(wager_price),
        "estimatedCostUsdc": _money(estimated_cost),
        "reportedVolumeUsdc": _money(volume),
        "daysToResolution": days_left,
        "priceEdge": _money(edge),
        "negRisk": market.negRisk,
        "walletBalanceUsdc": request.walletBalanceUsdc,
        "signals": _signals(preview.outcome, market_price, wager_price, estimated_cost, volume, days_left),
        "ruleRisks": _risks(estimated_cost, volume, edge, days_left, request.walletBalanceUsdc),
    }


async def _gemini_advice(context: dict[str, Any]) -> WagerAdviceResponse:
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is required for Gemini wager advice.",
        )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": _gemini_prompt(context)
                    }
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 2048,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.gemini_model}:generateContent"
    )

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            params={"key": settings.gemini_api_key},
            json=payload,
        )
        response.raise_for_status()

    raw_advice = _normalize_advice(json.loads(_clean_json_text(_extract_gemini_text(response.json()))))
    return WagerAdviceResponse(source="llm", **raw_advice)


def _gemini_prompt(context: dict[str, Any]) -> str:
    return f"{GEMINI_ADVICE_INSTRUCTIONS}\n\nWager context:\n{json.dumps(context, ensure_ascii=True)}"


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates", [])
    if not candidates:
        prompt_feedback = payload.get("promptFeedback", {})
        raise KeyError(f"No Gemini candidates returned. promptFeedback={prompt_feedback}")

    finish_reason = candidates[0].get("finishReason")
    if finish_reason and finish_reason not in {"STOP", "MAX_TOKENS"}:
        raise ValueError(f"Gemini finished with {finish_reason}.")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        text = part.get("text")
        if isinstance(text, str) and text:
            return text

    raise KeyError(f"No Gemini text returned. candidate={candidates[0]}")


def _gemini_error_detail(error: httpx.HTTPStatusError) -> str:
    try:
        payload = error.response.json()
    except json.JSONDecodeError:
        return f"Gemini request failed with status {error.response.status_code}."

    message = payload.get("error", {}).get("message")
    if isinstance(message, str) and message:
        return f"Gemini request failed: {message}"
    return f"Gemini request failed with status {error.response.status_code}."


def _clean_json_text(value: str) -> str:
    text = value.strip()
    if text.startswith("```json"):
        text = text.removeprefix("```json").strip()
    if text.startswith("```"):
        text = text.removeprefix("```").strip()
    if text.endswith("```"):
        text = text.removesuffix("```").strip()
    return text


def _normalize_advice(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("LLM advice must be a JSON object.")

    required = ["recommendation", "confidence", "summary", "signals", "risks", "nextSteps", "disclaimer"]
    missing = [key for key in required if key not in value]
    if missing:
        raise ValueError(f"LLM advice is missing keys: {', '.join(missing)}")

    return value


def _signals(
    outcome: str,
    market_price: Decimal,
    wager_price: Decimal,
    estimated_cost: Decimal,
    volume: Decimal,
    days_left: int | None,
) -> list[str]:
    signals = [
        f"Market-implied probability for {outcome}: {_percent(market_price)}.",
        f"Your limit price: {_percent(wager_price)}.",
        f"Estimated exposure: {_money(estimated_cost)} USDC.",
        f"Reported market volume: {_money(volume)} USDC.",
    ]
    if days_left is not None:
        signals.append(f"Time to resolution: about {days_left} days.")
    return signals


def _risks(
    estimated_cost: Decimal,
    volume: Decimal,
    edge: Decimal,
    days_left: int | None,
    wallet_balance: str | None,
) -> list[str]:
    risks: list[str] = []
    if estimated_cost > Decimal("2"):
        risks.append("The wager is larger than a tiny validation trade.")
    if volume < Decimal("10000"):
        risks.append("Lower-volume markets can have wider spreads and worse fills.")
    if abs(edge) > Decimal("0.10"):
        risks.append("Your price is far from the current market probability; confirm this is intentional.")
    if days_left is not None and days_left > 90:
        risks.append("Long-dated markets tie up capital and carry more information risk.")
    if wallet_balance:
        balance = _decimal(wallet_balance)
        if balance > 0 and estimated_cost / balance > Decimal("0.25"):
            risks.append("This wager uses more than 25% of the provided wallet balance.")
    return risks


def _decimal_at(values: list[str], index: int) -> Decimal:
    if index >= len(values):
        return Decimal("0")
    return _decimal(values[index])


def _decimal(value: str | None) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except InvalidOperation:
        return Decimal("0")


def _percent(value: Decimal) -> str:
    return f"{(value * Decimal('100')).quantize(Decimal('0.01'))}%"


def _money(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.001")), "f")


def _days_until(value: str) -> int | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max((parsed - datetime.now(UTC)).days, 0)
