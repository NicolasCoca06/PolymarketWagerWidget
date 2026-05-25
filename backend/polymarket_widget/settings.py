from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    gamma_api_base: str = os.getenv("GAMMA_API_BASE", "https://gamma-api.polymarket.com")
    clob_api_base: str = os.getenv("CLOB_API_BASE", "https://clob.polymarket.com")
    polygon_chain_id: int = int(os.getenv("POLYGON_CHAIN_ID", "137"))
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    cors_origins: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]


settings = Settings()
