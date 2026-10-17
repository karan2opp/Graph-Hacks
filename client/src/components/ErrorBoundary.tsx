import { Component, type ReactNode } from 'react'

/** Last line of defence: a render error shows a calm page instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page">
        <div className="empty" role="alert">
          <h1 className="page-title">Something went wrong on this page</h1>
          <p className="ink-2">Your data is safe. Reload the page to continue.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    )
  }
}
