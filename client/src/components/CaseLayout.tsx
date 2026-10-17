import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router'
import { shortTitle, useCaseCards } from '../lib/queries'
import { Crumb, TopBar } from './TopBar'
import { ErrorBoundary } from './ErrorBoundary'
import { ErrorState, PageLoader } from './ui'

/** Shell for every page inside a case: bench header, the case's side menu, and the page. */
export function CaseLayout() {
  const { caseId = '' } = useParams()
  const cards = useCaseCards()
  const card = cards.data?.find((c) => c.case.id === caseId)

  const { pathname } = useLocation()

  // Keep the bench header while the case loads, and show a case already loaded even if a refresh failed.
  if (cards.data === undefined && !cards.isError)
    return (
      <>
        <TopBar />
        <PageLoader label="Opening the case" />
      </>
    )
  if (!card)
    return (
      <>
        <TopBar />
        <main className="page">
          <ErrorState
            error={cards.error ?? new Error('This case was not found. It may belong to another firm.')}
            retry={cards.isError ? () => cards.refetch() : undefined}
            title="Case not found"
          />
          <Link to="/app">Back to all cases</Link>
        </main>
      </>
    )

  const tab = (to: string, label: string, extra?: React.ReactNode, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
      {label}
      {extra}
    </NavLink>
  )
  return (
    <>
      <TopBar
        crumbs={<Crumb to={`/app/cases/${caseId}`}>{shortTitle(card.case.title)}</Crumb>}
        right={
          <Link to={`/app/cases/${caseId}/ask`} className="ask-box">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2 3h12v8H6l-4 3z" />
            </svg>
            Ask this case anything…
          </Link>
        }
      />
      <div className="shell">
        <nav className="sidenav" aria-label="Case sections">
          {tab(`/app/cases/${caseId}`, 'Brief', null, true)}
          {tab(`/app/cases/${caseId}/hearings`, 'Hearings & transcripts', <span className="count">{card.hearings}</span>)}
          {tab(`/app/cases/${caseId}/documents`, 'Documents', <span className="count">{card.documents}</span>)}
          {tab(`/app/cases/${caseId}/add`, 'Add to memory')}
          {tab(`/app/cases/${caseId}/drift`, 'Story drift', card.newContradictions ? <span className="badge">{card.newContradictions} new</span> : null)}
          {tab(`/app/cases/${caseId}/directions`, 'Directions', card.overdue ? <span className="badge">{card.overdue} overdue</span> : null)}
          {tab(`/app/cases/${caseId}/ask`, 'Ask the case')}
          {card.linked.length > 0 && (
            <div className="nav-extra stack" style={{ gap: 4 }}>
              <div className="divider" />
              <span className="muted" style={{ fontSize: 12, padding: '0 12px' }}>
                Linked {card.linked.length === 1 ? 'case' : 'cases'}
              </span>
              {card.linked.map((l) => (
                <Link key={l.id} to={`/app/cases/${l.id}`}>
                  <span className="typed" style={{ fontSize: 13 }}>
                    {l.caseNumber}
                  </span>
                  {l.reason && (
                    <span className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
                      {l.reason.length > 22 ? 'linked' : l.reason}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </nav>
        <main className="main" id="main">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </>
  )
}
