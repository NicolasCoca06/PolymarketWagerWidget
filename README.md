# Polymarket Wager Widget


## Capabilities

- React + TypeScript widget
- Python FastAPI backend
- Polymarket Gamma market discovery
- Wager preview and validation
- MetaMask wallet connection
- Polymarket deposit wallet flow
- Real CLOB order signing with `POLY_1271`

## Architecture

Read the architecture note first:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/BRANCHING.md](docs/BRANCHING.md)

The short version:

```text
frontend/src/components/PolymarketWagerWidget.tsx
  UI composition and workflow state

frontend/src/lib/
  API client, wallet helpers, Polymarket SDK integration, types

backend/app.py
  ASGI entrypoint only

backend/polymarket_widget/
  settings, schemas, market discovery, wager building
```

## Widget Usage

`frontend/src/App.tsx` is only a host page:

```tsx
import { PolymarketWagerWidget } from './components/PolymarketWagerWidget'

function App() {
  return (
    <main className="app-shell">
      <PolymarketWagerWidget backendUrl="http://127.0.0.1:8000" defaultDryRun />
    </main>
  )
}
```

Available props:

- `backendUrl`: Python API base URL
- `initialMarketId`: optional Polymarket condition ID to preselect
- `defaultDryRun`: safe default for signing without posting
- `marketLimit`: number of active markets to load
- `onPreviewCreated`: callback after preview
- `onWagerPlaced`: callback after signing/posting

## API

- `GET /api/health`
- `GET /api/markets`
- `GET /api/markets/{condition_id}`
- `POST /api/wagers/preview`
- `POST /api/wagers/place` legacy backend signing endpoint

The product path signs in the browser with the user's wallet. The Python `place` endpoint is retained only as a legacy technical-test boundary and is not exposed in the UI.

## Real Wallet Flow

1. Install MetaMask.
2. Create or import a wallet you control.
3. Switch to Polygon when the widget asks.
4. Fund with a small amount of USDC on Polygon.
5. Connect the wallet in the widget.
6. Click `Prepare` in the deposit wallet box.
7. If needed, click `Deploy`.
8. Fund the deposit wallet through Polymarket's deposit flow.
9. Use `Sign without posting` first.
10. Change to `Post real order` only when intentionally posting a real order.

In the professional path, the private key never goes to the Python backend. MetaMask signs EIP-712 messages in the browser, and the deposit wallet is used as the order funder.

## Safety

`dryRun` defaults to `true`.

The UI does not ask for private keys. Real signing happens in MetaMask.

## Run Locally

### Backend

`py_clob_client_v2` requires Python >= 3.9.10. This project uses one local backend venv:

```bash
cd backend
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Verification

```bash
cd backend
.venv/bin/python -c "from fastapi.testclient import TestClient; import app; c=TestClient(app.app); print(c.get('/api/health').json())"

cd ../frontend
npm run build
```
