# Architecture


- The frontend owns wallet connection and wallet-side signing.
- The backend owns market discovery, wager preview, and explainable advice.
- Real private keys are not sent to the backend in the professional path.
- Polymarket deposit wallets are modeled as a first-class step, because real trading requires them.

## System Boundaries

```text
React Widget
  - UI composition
  - MetaMask connection
  - Compact widget workflow
  - Deposit wallet flow
  - CLOB signing/posting with wallet-side EIP-712 signatures

FastAPI Backend
  - Polymarket Gamma market discovery
  - Wager preview and validation
  - Explainable wager advice
  - Legacy private-key signing endpoint, kept out of the UI

Polymarket
  - Gamma API for markets
  - Builder Relayer for deposit wallets
  - CLOB API for orders
```

## Backend Layout

```text
backend/app.py
backend/polymarket_widget/api.py
backend/polymarket_widget/settings.py
backend/polymarket_widget/schemas.py
backend/polymarket_widget/markets.py
backend/polymarket_widget/wagers.py
backend/polymarket_widget/advisor.py
backend/polymarket_widget/prompts.py
backend/polymarket_widget/wallets.py
backend/polymarket_widget/clob_demo.py
```

`app.py` is intentionally tiny. It exposes the ASGI app and nothing else.

`api.py` is the HTTP boundary. It registers routes and delegates work.

`schemas.py` is the contract with the frontend.

`markets.py` hides Polymarket Gamma quirks. The search endpoint filters locally because Gamma's `search` behavior is not reliable enough for a crisp widget experience.

`wagers.py` is pure wager construction and validation.

`advisor.py` is the AI-assistance boundary. It returns an explainable recommendation from market probability, user price, cost, volume, and time-to-resolution signals. It calls Gemini and returns `source: "llm"`. Missing or unavailable Gemini configuration fails explicitly instead of falling back to deterministic rules.

`prompts.py` keeps LLM instructions separate from request orchestration and parsing, so prompt changes are easy to review.

`wallets.py` creates legacy demo wallets only.

`clob_demo.py` keeps private-key signing isolated. It is retained for technical-test compatibility, but the product UI does not expose it.

## Frontend Layout

```text
frontend/src/components/PolymarketWagerWidget.tsx
frontend/src/lib/api.ts
frontend/src/lib/browserWallet.ts
frontend/src/lib/polymarket.ts
frontend/src/lib/types.ts
frontend/src/lib/config.ts
```

The component is now a composition surface. It coordinates state and renders the workflow, while the domain mechanics live in `lib`.

`api.ts` is the backend client.

`browserWallet.ts` owns MetaMask and Polygon network concerns.

`polymarket.ts` owns SDK integration for deposit wallets, CLOB clients, signing, and posting.

`types.ts` is the shared frontend vocabulary.

The widget flow is intentionally step-based:

```text
Market -> Wager -> Insight -> Review -> Confirmation
```

`Review` is only available after a preview exists, and the final signing/posting action requires an explicit confirmation dialog.

## Security Posture

The professional path is non-custodial:

```text
MetaMask signs in browser -> Polymarket SDK posts order
```

The backend never receives the user's real private key.

The legacy backend signing path still exists because technical tests sometimes ask for Python signing, but it is deliberately isolated and kept out of the UI:

```text
Legacy backend endpoint -> private key payload -> test wallet only
```

## Tradeoffs

The Builder Relayer SDK and CLOB SDK are intentionally loaded with dynamic imports. The first screen should stay lean; wallet/deposit-wallet machinery is only loaded when the user enters that path. The relayer chunk is still large because the official SDK is large, but it no longer inflates the initial widget bundle.

The backend search fetches multiple market pages and filters locally. This is less API-efficient than a reliable server-side search, but it creates predictable behavior for the widget.

## What Good Looks Like

The project is considered healthy when:

- `npm run build` passes.
- `GET /api/health` returns `{"status":"ok"}`.
- Market search returns relevant active markets.
- The AI assistant returns explainable signals before signing.
- Dry-run signing works without funds.
- Real orders use the deposit wallet flow and return a CLOB response.
