import { useEffect, useState } from 'react'
import { api, ApiError } from './lib/api'

interface Health {
  status: 'ok' | 'degraded'
  uptime: number
  services: Record<string, string>
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Health>('/health')
      .then((res) => setHealth(res.data))
      .catch((e: unknown) => {
        // A degraded API (e.g. FalkorDB down) still returns a body with details.
        setError(e instanceof ApiError ? e.message : 'API unreachable')
      })
  }, [])

  return (
    <main className="app">
      <h1>Court Case Memory Agent</h1>
      <p className="tagline">A graph memory for every hearing, order, claim and deadline.</p>

      <section className="card">
        <h2>System status</h2>
        {error && <p className="bad">{error}</p>}
        {health && (
          <ul>
            <li>API: <b className={health.status === 'ok' ? 'ok' : 'bad'}>{health.status}</b></li>
            {Object.entries(health.services).map(([name, state]) => (
              <li key={name}>{name}: {state}</li>
            ))}
          </ul>
        )}
        {!health && !error && <p>Checking…</p>}
      </section>
    </main>
  )
}
