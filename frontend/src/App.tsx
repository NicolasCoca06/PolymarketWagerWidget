import { PolymarketWagerWidget } from './components/PolymarketWagerWidget'
import './App.css'

function App() {
  return (
    <main className="app-shell">
      <PolymarketWagerWidget backendUrl="http://127.0.0.1:8000" defaultDryRun />
    </main>
  )
}

export default App
