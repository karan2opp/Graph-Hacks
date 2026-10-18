import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { motion, MotionConfig } from 'motion/react'
import { SiteFooter, SiteHeader } from './SiteChrome'
import { CONTACT, REPO } from './site'
import { rise } from './variants'
import './landing.css'

export type LegalDoc = 'privacy' | 'terms' | 'cookies'

const UPDATED = '17 October 2026'

const Contact = () => (
  <a href={CONTACT} target="_blank" rel="noreferrer">
    the project's GitHub issues
  </a>
)

/** Each document: a plain-language summary, then its sections. */
const DOCS: Record<LegalDoc, { title: string; summary: ReactNode; sections: { heading: string; body: ReactNode }[] }> = {
  privacy: {
    title: 'Privacy policy',
    summary: (
      <>
        Case Memory is a demonstration project built for the Graph Hacks hackathon. We collect what it needs to sign you in and to read the
        case material you add. We use one cookie, to keep you signed in. We don't sell data, show ads or run analytics. Please use synthetic or
        public material only, never real client documents.
      </>
    ),
    sections: [
      {
        heading: 'Who we are',
        body: (
          <p>
            Case Memory is an open-source project (<a href={REPO} target="_blank" rel="noreferrer">source code</a>) built for Graph Hacks by
            WeMakeDevs and FalkorDB. "We" means the people who run this deployment of it. To reach us, open an issue on <Contact />. Issues are
            public, so don't include personal details there; say how to reach you and we'll follow up.
          </p>
        ),
      },
      {
        heading: 'What we collect',
        body: (
          <ul>
            <li>
              <b>Your account:</b> your name, email address, your firm's name and your role in it. Your password is never stored, only a scrypt
              hash of it. When an owner invites a colleague, we keep the invited email address until the invite is used or expires.
            </li>
            <li>
              <b>Your sign-in:</b> a random token in a cookie (see the <Link to="/cookies">cookie policy</Link>). We store only a SHA-256 hash of
              it, with its expiry date.
            </li>
            <li>
              <b>The case material you add:</b> case details; the names and roles of parties, lawyers, judges and witnesses; hearings; documents,
              files and transcripts; notes; what the agents extract from them (statements, directions, contradictions); and the questions you
              ask with their answers.
            </li>
            <li>
              <b>Technical data:</b> our server logs each request (IP address, time, address requested, browser). Sign-in and sign-up attempts
              are counted by IP address and email for a few minutes, in memory only, to stop password guessing.
            </li>
          </ul>
        ),
      },
      {
        heading: 'How we use it',
        body: (
          <p>
            Only to run the service: to sign you in, keep each firm's cases separate, read your documents and transcripts, answer your
            questions with sources, and protect the service from abuse. We don't use it for advertising or profiling, and we don't sell it.
          </p>
        ),
      },
      {
        heading: 'Who processes it for us',
        body: (
          <ul>
            <li>
              <b>OpenAI</b> receives the text of documents and transcripts, images of scanned pages, and your questions with the case record they
              draw on, to extract statements, build search indexes and write answers.
            </li>
            <li>
              <b>ImageKit</b> stores the original files you upload. Anyone who has a file's link can open it, which is one more reason to upload
              only synthetic or public material.
            </li>
            <li>
              <b>Our hosting providers</b> run the website, the API and the FalkorDB database that holds the case graph.
            </li>
            <li>
              <b>Google Fonts</b> serves the typefaces. Your browser fetches them from Google, which sees your IP address.
            </li>
          </ul>
        ),
      },
      {
        heading: 'Who else can see your cases',
        body: (
          <p>
            Everyone in your firm can see all of your firm's cases. Other firms can't: every request is checked against the firm that owns the
            case, document or finding.
          </p>
        ),
      },
      {
        heading: 'How long we keep it',
        body: (
          <p>
            Account and case data stays until it is deleted. Sign-ins end when you sign out or after 14 days. Invites expire after 7 days. Server
            logs are kept as long as our hosting providers keep them. This is a demo, so we may reset or shut it down at any time, deleting its
            data.
          </p>
        ),
      },
      {
        heading: 'Your choices and rights',
        body: (
          <p>
            A firm owner can remove a member, which deletes that person's account and ends their sign-ins. For anything else, such as a copy of
            your data, a correction, or deleting your account or a case, ask us through <Contact />. Depending on where you live, you may also have
            the right to complain to a data protection authority.
          </p>
        ),
      },
      {
        heading: 'Security',
        body: (
          <p>
            Passwords and sign-in tokens are stored only as hashes, the sign-in cookie can't be read by scripts, and every request is checked
            against your firm. Still, this is a hackathon demo, not a hardened service. Don't put confidential material into it.
          </p>
        ),
      },
      { heading: 'Children', body: <p>Case Memory is meant for legal professionals and isn't intended for anyone under 18.</p> },
      { heading: 'Changes', body: <p>If this policy changes, we'll update this page and the date at the top.</p> },
    ],
  },

  terms: {
    title: 'Terms of use',
    summary: (
      <>
        Case Memory is a free demo, provided as is. It helps organise a case but isn't legal advice, and what its AI writes can be wrong, so
        check every answer against its sources. Use synthetic or public material only, and don't misuse the service.
      </>
    ),
    sections: [
      {
        heading: 'The service',
        body: (
          <p>
            Case Memory is a case organiser and memory aid built for the Graph Hacks hackathon. It keeps a case's hearings, orders, filings and
            transcripts in a graph, and uses AI agents to extract statements, track directions, flag contradictions and answer questions with
            sources.
          </p>
        ),
      },
      {
        heading: 'Not legal advice',
        body: (
          <p>
            Everything the service produces is generated by AI and may be wrong or incomplete. Every answer cites its sources; check them before
            relying on anything. Case Memory doesn't replace a lawyer's judgment, and using it creates no lawyer–client relationship.
          </p>
        ),
      },
      {
        heading: 'Your account',
        body: (
          <p>
            Give accurate details, keep your password to yourself, and tell us if you think someone else has used your account. You're
            responsible for what happens under it. Firm owners decide who joins their firm and can remove members.
          </p>
        ),
      },
      {
        heading: 'Your content',
        body: (
          <p>
            You keep all rights in what you upload. You let us store it and process it, including through the providers named in the{' '}
            <Link to="/privacy">privacy policy</Link>, only to run the service for you. You confirm you have the right to upload it. Don't upload
            confidential client documents, or other people's personal data without a lawful basis; use synthetic or public material.
          </p>
        ),
      },
      {
        heading: 'Fair use',
        body: (
          <ul>
            <li>Don't upload anything unlawful, or anything you aren't allowed to share.</li>
            <li>Don't try to reach another firm's data, test the service's security without permission, or get around its limits.</li>
            <li>
              Don't overload the service or scrape it. Calls to the AI agents are capped per firm per hour so the demo stays available to
              everyone.
            </li>
          </ul>
        ),
      },
      {
        heading: 'Availability',
        body: (
          <p>
            The service is free and may change, be limited, be reset or shut down at any time, and its data may be deleted. There is no
            guarantee that it will be available or error-free.
          </p>
        ),
      },
      {
        heading: 'Open source',
        body: (
          <p>
            The source code is published on <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>. These terms cover this deployment of
            it, not the code.
          </p>
        ),
      },
      {
        heading: 'Disclaimer and liability',
        body: (
          <p>
            To the extent the law allows, the service is provided "as is", without warranties of any kind, and we aren't liable for any loss that
            comes from using it or from relying on what it produces, including decisions made in a case.
          </p>
        ),
      },
      {
        heading: 'Ending',
        body: (
          <p>
            You can stop using Case Memory at any time and ask us to delete your account. We may suspend accounts that break these terms.
          </p>
        ),
      },
      {
        heading: 'Changes and contact',
        body: (
          <p>
            If these terms change, we'll update this page and the date at the top; using the service after that means you accept the new
            terms. Questions go to <Contact />.
          </p>
        ),
      },
    ],
  },

  cookies: {
    title: 'Cookie policy',
    summary: (
      <>
        Case Memory sets one cookie, and only so you stay signed in. There are no advertising, analytics or tracking cookies, so there's
        nothing to opt in or out of.
      </>
    ),
    sections: [
      {
        heading: 'The cookie we set',
        body: (
          <div className="legal-table" role="region" aria-label="Cookies" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>What it does</th>
                  <th>Kind</th>
                  <th>How long</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="typed">cm_session</td>
                  <td>Keeps you signed in. It holds a random token; we keep only a hash of it.</td>
                  <td>Strictly necessary, first-party, not readable by scripts</td>
                  <td>Until you sign out, or 14 days</td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        heading: 'Other storage',
        body: (
          <p>
            The app doesn't store anything else in your browser: no local storage or session storage, and no tracking pixels. When you open an
            uploaded file, it is served by ImageKit. Fonts come from Google Fonts. We don't use either to set cookies.
          </p>
        ),
      },
      {
        heading: 'Managing cookies',
        body: (
          <p>
            You can block or delete cookies in your browser's settings. If you block <span className="typed">cm_session</span>, you won't be able
            to sign in. Signing out deletes it.
          </p>
        ),
      },
      { heading: 'Changes', body: <p>If we ever add another cookie, we'll list it here and update the date at the top.</p> },
    ],
  },
}

const ORDER: LegalDoc[] = ['privacy', 'terms', 'cookies']
const PATH: Record<LegalDoc, string> = { privacy: '/privacy', terms: '/terms', cookies: '/cookies' }

/** Privacy policy, terms of use and cookie policy, in the landing page's look. */
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const { title, summary, sections } = DOCS[doc]

  useEffect(() => {
    document.title = `${title} · Case Memory`
    window.scrollTo(0, 0)
    return () => {
      document.title = 'Case Memory'
    }
  }, [title])

  return (
    <MotionConfig reducedMotion="user">
      <div className="landing">
        <div className="wood">
          <SiteHeader />
          <div className="brass-strip" />
        </div>

        <main className="legal">
          <nav className="legal-nav" aria-label="Legal documents">
            {ORDER.map((d) => (
              <Link key={d} to={PATH[d]} aria-current={d === doc ? 'page' : undefined}>
                {DOCS[d].title}
              </Link>
            ))}
          </nav>

          <motion.article key={doc} className="legal-doc sheet" initial="hidden" animate="show" variants={rise}>
            <h1>{title}</h1>
            <p className="legal-updated typed">Last updated {UPDATED}</p>
            <p className="legal-summary">{summary}</p>
            {sections.map(({ heading, body }) => (
              <section key={heading}>
                <h2>{heading}</h2>
                {body}
              </section>
            ))}
          </motion.article>
        </main>

        <SiteFooter />
      </div>
    </MotionConfig>
  )
}
