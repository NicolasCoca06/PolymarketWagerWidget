from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .clob_demo import sign_or_post_demo_order
from .markets import fetch_market_by_condition_id, fetch_markets
from .schemas import (
    MarketSummary,
    PlaceWagerRequest,
    PlaceWagerResponse,
    WalletResponse,
    WagerPreviewRequest,
    WagerPreviewResponse,
)
from .settings import settings
from .wagers import build_wager_preview
from .wallets import create_demo_wallet


def create_app() -> FastAPI:
    app = FastAPI(
        title="Polymarket Widget API",
        description="Backend boundary for market discovery and wager previews.",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    _register_routes(app)
    return app


def _register_routes(app: FastAPI) -> None:
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/markets", response_model=list[MarketSummary])
    async def get_markets(
        limit: int = Query(12, ge=1, le=100),
        search: str | None = Query(None, min_length=2),
    ) -> list[MarketSummary]:
        return await fetch_markets(limit=limit, search=search)

    @app.get("/api/markets/{condition_id}", response_model=MarketSummary)
    async def get_market(condition_id: str) -> MarketSummary:
        return await fetch_market_by_condition_id(condition_id)

    @app.post("/api/wallet-demo", response_model=WalletResponse)
    def wallet_demo() -> WalletResponse:
        return create_demo_wallet()

    @app.post("/api/wagers/preview", response_model=WagerPreviewResponse)
    async def preview_wager(request: WagerPreviewRequest) -> WagerPreviewResponse:
        market = await fetch_market_by_condition_id(request.marketId)
        return build_wager_preview(market, request)

    @app.post("/api/wagers/place", response_model=PlaceWagerResponse)
    async def place_wager(request: PlaceWagerRequest) -> PlaceWagerResponse:
        market = await fetch_market_by_condition_id(request.marketId)
        preview = build_wager_preview(market, request)

        if not request.privateKey:
            return PlaceWagerResponse(
                preview=preview,
                dryRun=True,
                message="Preview created. Add a test private key to sign or post an order.",
            )

        signed_order, exchange_response = sign_or_post_demo_order(
            preview=preview,
            private_key=request.privateKey,
            funder_address=request.funderAddress,
            signature_type=request.signatureType,
            dry_run=request.dryRun,
        )

        return PlaceWagerResponse(
            preview=preview,
            dryRun=request.dryRun,
            signedOrder=signed_order,
            exchangeResponse=exchange_response,
            message=(
                "Order signed locally in Python. dryRun=true, so it was not posted."
                if request.dryRun
                else "Order posted to Polymarket CLOB."
            ),
        )
