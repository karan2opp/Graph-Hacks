import { Component, type ReactNode } from 'react'

/** After a deploy, a tab still on the old version can't load the new code for a page. */
const isStaleBuild = (e: Error) => /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(`${e.name} ${e.message}`)

/**
 * Catches a render error so it shows a calm message instead of a blank screen. With `resetKey`
 * (the route), moving to another page clears the error, so one broken page doesn't stop the app.
 */
type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null; key?: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }
  componentDidCatch(error: Error) {
    console.error(error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleBuild(error)
    return (
      <main className="page">
        <div className="empty" role="alert">
          <h1 className="page-title">{stale ? 'Case Memory has been updated' : 'Something went wrong on this page'}</h1>
          <p className="ink-2">{stale ? 'Reload to get the latest version. Your data is safe.' : 'Your data is safe. Try again, or go back to your cases.'}</p>
          <div className="row">
            {stale ? (
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
                  Try again
                </button>
                <a className="btn" href="/app">
                  Go to your cases
                </a>
              </>
            )}
          </div>
        </div>
      </main>
    )
  }
}
