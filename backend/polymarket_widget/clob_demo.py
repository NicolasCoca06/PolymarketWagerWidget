from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from .schemas import OrderSide, WagerPreviewResponse
from .settings import settings


def sign_or_post_demo_order(
    *,
    preview: WagerPreviewResponse,
    private_key: str,
    funder_address: str | None,
    signature_type: int,
    dry_run: bool,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    client = _authenticated_client(private_key, funder_address, signature_type)
    _, OrderArgs, OrderType, PartialCreateOrderOptions, Side = _clob_imports()
    order_side = Side.BUY if preview.side == OrderSide.buy else Side.SELL

    order_args = OrderArgs(
        price=float(preview.price),
        size=float(preview.size),
        side=order_side,
        token_id=preview.tokenId,
    )
    options = PartialCreateOrderOptions(
        tick_size=preview.minTickSize,
        neg_risk=preview.negRisk,
    )

    signed_order = client.create_order(order_args, options=options)
    signed_payload = _payload(signed_order)
    if dry_run:
        return signed_payload, None

    exchange_response = client.post_order(signed_order, OrderType.GTC)
    return signed_payload, _payload(exchange_response)


def _authenticated_client(
    private_key: str,
    funder_address: str | None,
    signature_type: int,
) -> Any:
    ClobClient, _, _, _, _ = _clob_imports()
    bootstrap_client = ClobClient(
        host=settings.clob_api_base,
        key=private_key,
        chain_id=settings.polygon_chain_id,
        signature_type=signature_type,
        funder=funder_address,
    )
    creds = bootstrap_client.create_or_derive_api_key()
    return ClobClient(
        host=settings.clob_api_base,
        key=private_key,
        chain_id=settings.polygon_chain_id,
        creds=creds,
        signature_type=signature_type,
        funder=funder_address,
    )


def _clob_imports() -> tuple[Any, Any, Any, Any, Any]:
    try:
        from py_clob_client_v2 import (
            ClobClient,
            OrderArgs,
            OrderType,
            PartialCreateOrderOptions,
            Side,
        )
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "py-clob-client-v2 is not installed. "
                "Run `pip install -r requirements.txt` in backend."
            ),
        ) from exc

    return ClobClient, OrderArgs, OrderType, PartialCreateOrderOptions, Side


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return getattr(value, "__dict__", {"raw": str(value)})
