import { lazy, Suspense } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { CaseLayout } from './components/CaseLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TopBar } from './components/TopBar'
import { PageLoader } from './components/ui'
import { RedirectIfSignedIn, RequireAuth } from './lib/auth'
import { AddHearingPage } from './pages/AddHearing'
import { AddMaterialPage } from './pages/AddMaterial'
import { AskPage } from './pages/Ask'
import { InvitePage, LoginPage, RegisterPage } from './pages/Auth'
import { BriefPage } from './pages/Brief'
import { CasesPage } from './pages/Cases'
import { DirectionsPage } from './pages/Directions'
import { DocViewerPage, DocumentsPage } from './pages/Documents'
import { HearingPage, HearingsPage } from './pages/Hearings'
import { NewCasePage } from './pages/NewCase'
import { SettingsPage } from './pages/Settings'
import { StoryDriftPage } from './pages/StoryDrift'

// The landing page carries the scroll animation; keep it out of the app bundle.
const LandingPage = lazy(() => import('./pages/Landing'))
const LegalPage = lazy(() => import('./pages/landing/Legal'))

function NotFound() {
  return (
    <>
      <TopBar />
      <main className="page">
        <div className="empty">
          <span className="typed muted">Error 404</span>
          <h1 className="page-title">This page is not on the record</h1>
          <p className="ink-2">The link may be old, or the page was moved.</p>
          <Link to="/app" className="btn btn-primary">
            Go to your cases
          </Link>
        </div>
      </main>
    </>
  )
}

export default function App() {
  // A page that crashes shows its own error; moving to another page clears it.
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<PageLoader />}>
            <LandingPage />
          </Suspense>
        }
      />
      {(['privacy', 'terms', 'cookies'] as const).map((doc) => (
        <Route
          key={doc}
          path={`/${doc}`}
          element={
            <Suspense fallback={<PageLoader />}>
              <LegalPage doc={doc} />
            </Suspense>
          }
        />
      ))}
      <Route path="/login" element={<RedirectIfSignedIn><LoginPage /></RedirectIfSignedIn>} />
      <Route path="/register" element={<RedirectIfSignedIn><RegisterPage /></RedirectIfSignedIn>} />
      <Route path="/invite/:token" element={<RedirectIfSignedIn><InvitePage /></RedirectIfSignedIn>} />

      <Route path="/app" element={<RequireAuth />}>
        <Route index element={<CasesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="cases/new" element={<NewCasePage />} />
        <Route path="cases/:caseId" element={<CaseLayout />}>
          <Route index element={<BriefPage />} />
          <Route path="hearings" element={<HearingsPage />} />
          <Route path="hearings/new" element={<AddHearingPage />} />
          <Route path="hearings/:hearingId" element={<HearingPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="documents/:documentId" element={<DocViewerPage />} />
          <Route path="add" element={<AddMaterialPage />} />
          <Route path="drift" element={<StoryDriftPage />} />
          <Route path="directions" element={<DirectionsPage />} />
          <Route path="ask" element={<AskPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </ErrorBoundary>
  )
}
