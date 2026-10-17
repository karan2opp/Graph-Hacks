import { Link } from 'react-router'
import { motion } from 'motion/react'
import { Logo } from '../../components/TopBar'
import { CONTACT, REPO } from './site'
import { group, onView, press, rise } from './variants'

/** Sections of the landing page. Root-relative, so they also work from the legal pages. */
const SECTIONS = [
  { href: '/#pipeline', label: 'How it works' },
  { href: '/#cause', label: 'Cause list' },
  { href: '/#orders', label: 'Orders' },
  { href: '/#ask', label: 'Ask' },
]

type FooterLink = { label: string; to?: string; href?: string }

const FOOTER: { heading: string; links: FooterLink[] }[] = [
  { heading: 'Product', links: SECTIONS.map(({ href, label }) => ({ href, label })) },
  {
    heading: 'Get started',
    links: [
      { label: 'Open the sample case', to: '/app' },
      { label: 'Sign in', to: '/login' },
      { label: 'Create a firm', to: '/register' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', to: '/privacy' },
      { label: 'Terms of use', to: '/terms' },
      { label: 'Cookie policy', to: '/cookies' },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'Source code', href: REPO },
      { label: 'Report an issue', href: CONTACT },
    ],
  },
]

const MotionLink = motion.create(Link)
const YEAR = new Date().getFullYear()

/** Logo, section links and sign in, on the bench-coloured band at the top of the public pages. */
export function SiteHeader() {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <Logo />
        Case Memory
      </Link>
      <nav aria-label="Main" className="topnav">
        {SECTIONS.map((s) => (
          <a key={s.href} className="toplink" href={s.href}>
            {s.label}
          </a>
        ))}
        <a className="toplink" href={REPO} target="_blank" rel="noreferrer">
          Code
        </a>
        <Link className="toplink" to="/login" style={{ fontWeight: 600 }}>
          Sign in
        </Link>
      </nav>
    </header>
  )
}

function FooterItem({ link }: { link: FooterLink }) {
  if (link.to) return <Link to={link.to}>{link.label}</Link>
  const external = link.href!.startsWith('http')
  return (
    <a href={link.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {link.label}
    </a>
  )
}

/** The closing call to action, then the site's links, legal pages and credits. */
export function SiteFooter() {
  return (
    <footer className="wood">
      <div className="brass-strip" />
      <motion.div className="wrap closing" {...onView} variants={group}>
        <motion.div className="closing-cta" variants={group}>
          <motion.h2 className="h2" variants={rise}>
            Walk into the next hearing knowing the whole file.
          </motion.h2>
          <MotionLink to="/app" className="btn" variants={rise} {...press}>
            Open the sample case
          </MotionLink>
        </motion.div>

        <motion.div className="footer-grid" variants={rise}>
          <div className="footer-brand">
            <Link to="/" className="brand">
              <Logo />
              Case Memory
            </Link>
            <p>Every hearing, order, filing and transcript of a case in one graph, read by agents that cite their sources.</p>
            <p className="footer-note">A memory aid for lawyers, not legal advice.</p>
          </div>
          {FOOTER.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="footer-col">
              <h3>{col.heading}</h3>
              <ul>
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterItem link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </motion.div>

        <motion.div className="credits" variants={rise}>
          <span>© {YEAR} Case Memory. Built for Graph Hacks by WeMakeDevs and FalkorDB.</span>
          <span>Demo data is synthetic.</span>
        </motion.div>
      </motion.div>
    </footer>
  )
}
