from __future__ import annotations

from eth_account import Account

from .schemas import WalletResponse


def create_demo_wallet() -> WalletResponse:
    account = Account.create()
    return WalletResponse(
        address=account.address,
        privateKey=account.key.hex(),
        warning="Demo wallet only. Do not fund it with meaningful assets or reuse the private key.",
    )
