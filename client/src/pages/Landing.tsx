import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { motion, MotionConfig, type Variants } from 'motion/react'
import { Pipeline } from './landing/Pipeline'
import './landing/landing.css'

const SECTIONS = [
  { href: '#pipeline', label: 'How it works' },
  { href: '#cause', label: 'Cause list' },
  { href: '#orders', label: 'Orders' },
  { href: '#ask', label: 'Ask' },
]

const CAUSE_LIST = [
  { item: 7, matter: 'Ramesh Kumar v. Suresh Gupta', listing: 'CS 412/2020, Sat 24 Oct', listedFor: 'Cross of DW1', note: 'Your rejoinder is 11 days late. 3 contradictions ready for cross.', ok: false },
  { item: 8, matter: 'Suresh Gupta v. Ramesh Kumar', listing: 'CS 98/2022, Sat 24 Oct', listedFor: 'Evidence', note: 'Nothing pending. Linked to item 7.', ok: true },
  { item: 3, matter: 'Meera Iyer v. Coastal Builders', listing: 'CC 88/2023, Thu 5 Nov', listedFor: 'Arguments', note: 'Costs of ₹5,000 still unpaid by the opposite party.', ok: false },
]

const REMEMBERED: { title: string; text: string; example: ReactNode }[] = [
  {
    title: 'Who changed their story',
    text: 'Every statement is compared with what the same person said before.',
    example: (
      <>
        <span className="muted">2021</span> denies receiving Rs. 5,00,000
        <br />
        <span className="muted">2023</span> received it as a friendly loan <b className="red">contradicts</b>
      </>
    ),
  },
  {
    title: 'What the court ordered',
    text: 'Deadlines are read from each order and checked against what was filed.',
    example: (
      <>
        Plaintiff to file rejoinder within three weeks.
        <br />
        <b className="red">11 days overdue</b> <span className="muted">(due 06.10.2026)</span>
      </>
    ),
  },
  {
    title: 'Where it was said',
    text: 'Answers point to the page and paragraph, or the transcript line.',
    example: (
      <>
        Written Statement, page 1, para 1
        <br />
        Hearing of 19.07.2024, line 7
      </>
    ),
  },
]

/** Stamp colours follow the app: red overdue, blue in force, green complied, brown for the rest. */
const ORDERS = [
  { date: '10.03.2021', text: 'Defendant to file written statement within 30 days.', stamp: 'FILED 39 DAYS LATE', color: 'var(--brown)', tilt: 2 },
  { date: '02.11.2021', text: 'Parties to maintain status quo on the shop premises.', stamp: 'IN FORCE', color: 'var(--blue)', tilt: -2 },
  { date: '11.03.2025', text: 'Costs of Rs. 2,000 on the defendant.', stamp: 'COMPLIED', color: 'var(--green)', tilt: 3 },
  { date: '15.09.2026', text: 'Plaintiff to file rejoinder within three weeks.', stamp: 'OVERDUE', color: 'var(--red)', tilt: -4 },
  { date: '15.09.2026', text: 'Defendant to produce original receipts by 22.10.2026.', stamp: 'DUE 22 OCT', color: 'var(--brown)', tilt: 2 },
]

const EXHIBITS = ['Written Statement, p1 para 1', 'Affidavit of DW1, p1 para 1', 'Affidavit of DW1, p1 para 2']
const Ex = ({ n }: { n: number }) => <span className="ex">(Ex. {n})</span>

/* ---------- motion ---------- */

const EASE = [0.2, 0.7, 0.2, 1] as const
/** Children play their own entrance one after another. */
const group: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
const rise: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }
const drop: Variants = { hidden: { opacity: 0, y: -28 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 180, damping: 20 } } }
/** A line drawing itself. Hidden until it starts: a zero-length round cap still shows a dot. */
const draw = (delay: number, duration: number): Variants => ({
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { delay, duration, ease: [0.6, 0, 0.2, 1], opacity: { delay, duration: 0.01 } } },
})
/** A rubber stamp coming down on the page. */
const stampDown: Variants = {
  hidden: { opacity: 0, scale: 1.8 },
  show: { opacity: 0.88, scale: 1, transition: { delay: 0.35, type: 'spring', stiffness: 500, damping: 18 } },
}
/** Plays a section's entrance once, when it scrolls into view. */
const onView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, amount: 0.2 } } as const
/** Buttons lift on hover and give on press. */
const press = { whileHover: { y: -2 }, whileTap: { scale: 0.97 } } as const

const MotionLink = motion.create(Link)

/** A page in the hero's case file, with the contradicting words marked. */
function FilePage({ className, tilt, heading, children }: { className: string; tilt: number; heading: string; children: ReactNode }) {
  return (
    <motion.div className={`file-page ruled ${className}`} style={{ rotate: tilt }} variants={drop}>
      <small>{heading}</small>
      <p>{children}</p>
    </motion.div>
  )
}

function Hero() {
  return (
    <section className="wood" aria-labelledby="hero">
      <header className="topbar">
        <Link to="/" className="brand">
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="#E9EFE5" strokeWidth="1.8" aria-hidden="true">
            <circle cx="6" cy="7" r="3" />
            <circle cx="22" cy="7" r="3" />
            <circle cx="14" cy="21" r="3" />
            <path d="M8.5 9l4 9.5M19.5 9l-4 9.5" stroke="#E0BE80" />
            <path d="M9 7h10" />
          </svg>
          Case Memory
        </Link>
        <nav aria-label="Main" className="topnav">
          {SECTIONS.map((s) => (
            <a key={s.href} className="toplink" href={s.href}>
              {s.label}
            </a>
          ))}
          <a className="toplink" href="https://github.com/karan2opp/Graph-Hacks" target="_blank" rel="noreferrer">
            Code
          </a>
          <Link className="toplink" to="/login" style={{ fontWeight: 600 }}>
            Sign in
          </Link>
        </nav>
      </header>

      <motion.div className="hero" initial="hidden" animate="show" variants={group}>
        <motion.div className="hero-copy" variants={group}>
          <motion.span className="caps kicker" variants={rise}>
            In the matter of every hearing you've had
          </motion.span>
          <motion.h1 id="hero" variants={rise}>
            Your case file, with a memory.
          </motion.h1>
          <motion.p className="lede" variants={rise}>
            Add hearings, orders and filings. It catches changed stories, tracks what the court ordered, and answers with the exact paragraph.
          </motion.p>
          <MotionLink className="btn start" to="/app" variants={rise} {...press}>
            Open the sample case
          </MotionLink>
        </motion.div>

        <motion.figure
          className="case-file"
          aria-label="A case file where a red thread links a 2021 denial to a 2023 admission by the same person"
          variants={group}
        >
          <motion.div className="folder" style={{ rotate: -2.5 }} variants={rise} />
          <motion.div className="folder-tab" style={{ rotate: -2.5 }} variants={rise} />
          <motion.div className="folder-label typed" style={{ rotate: -2.5 }} variants={rise}>
            CS 412/2020
          </motion.div>
          <FilePage className="first" tilt={-1} heading="Written Statement, 18.05.2021">
            1. The defendant <mark>denies having received any payment of Rs. 5,00,000</mark> from the plaintiff.
          </FilePage>
          <FilePage className="second" tilt={1.6} heading="Affidavit of DW1, 06.02.2023">
            1. I <mark>received the said amount in March 2019 as a friendly loan.</mark>
          </FilePage>
          <svg className="thread-art" viewBox="0 0 560 560" width="100%" height="560" preserveAspectRatio="none" aria-hidden="true">
            <motion.path d="M150 160 C 60 230, 40 300, 120 330 S 260 300, 250 395" fill="none" stroke="#C42D22" strokeWidth="3" strokeLinecap="round" variants={draw(0.9, 1.4)} />
            <motion.circle cx="150" cy="160" r="5" fill="#C42D22" variants={rise} />
          </svg>
          <motion.svg className="hero-gavel" width="230" height="150" viewBox="0 -30 230 150" aria-hidden="true" variants={rise}>
            <ellipse cx="80" cy="104" rx="66" ry="10" fill="rgba(0,0,0,0.35)" />
            <rect x="22" y="80" width="116" height="22" rx="7" fill="#5A3726" />
            <rect x="30" y="72" width="100" height="12" rx="5" fill="#7A4E36" />
            <rect x="30" y="76" width="100" height="2" fill="#C9A464" />
            <g transform="translate(64 30) rotate(-10)">
              <rect x="19" y="-5" width="140" height="10" rx="5" fill="#7A4E36" />
              <circle cx="161" cy="0" r="7" fill="#5A3726" />
              <rect x="-19" y="-42" width="38" height="84" rx="8" fill="#6B4330" />
              <rect x="-19" y="-33" width="38" height="7" fill="#C9A464" />
              <rect x="-19" y="26" width="38" height="7" fill="#C9A464" />
              <rect x="-13" y="-38" width="6" height="76" rx="3" fill="rgba(255,255,255,0.12)" />
            </g>
          </motion.svg>
          <motion.div
            className="tag"
            style={{ rotate: -4 }}
            variants={{
              hidden: { opacity: 0, scale: 0.6 },
              show: { opacity: 1, scale: 1, transition: { delay: 2.1, type: 'spring', stiffness: 400, damping: 16 } },
            }}
          >
            Same person. Can't both be true.
          </motion.div>
        </motion.figure>
      </motion.div>
      <div className="brass-strip" />
    </section>
  )
}

function CauseList() {
  return (
    <motion.section id="cause" aria-labelledby="cause-h" className="wrap split" {...onView} variants={group}>
      <motion.div className="intro" variants={group}>
        <motion.h2 id="cause-h" className="h2" variants={rise}>
          Your cause list, already annotated.
        </motion.h2>
        <motion.p className="lede" variants={rise}>
          Before each date, every matter on your board tells you what is late, what is due, and what to raise.
        </motion.p>
        <MotionLink className="more start" to="/app" variants={rise}>
          See a case brief
        </MotionLink>
      </motion.div>
      <motion.div className="cause-list" variants={group}>
        <motion.div className="cause-head" variants={rise}>
          <svg width="36" height="30" viewBox="0 0 36 30" fill="none" stroke="#5B4A2A" strokeWidth="1.6" aria-hidden="true">
            <path d="M18 2v26M8 28h20M4 8h28" />
            <path d="M4 8l-3 9h6zM32 8l-3 9h6z" />
            <path d="M1 17a3 3 0 006 0M29 17a3 3 0 006 0" />
          </svg>
          <span className="caps">Cause list</span>
          <span className="typed">Matters of Adv. Kavita Rao, week of 19 October 2026</span>
        </motion.div>
        <motion.div className="cl cl-head" variants={rise}>
          <span>Item</span>
          <span>Matter</span>
          <span>Listed for</span>
          <span>Case Memory says</span>
        </motion.div>
        {CAUSE_LIST.map((row) => (
          <motion.div key={row.item} className="cl" variants={rise}>
            <span className="typed">{row.item}</span>
            <span className="cl-matter">
              <b>{row.matter}</b>
              <span className="typed">{row.listing}</span>
            </span>
            <span>{row.listedFor}</span>
            <span className={row.ok ? 'cl-note ok' : 'cl-note red'}>{row.note}</span>
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
  )
}

function Remembered() {
  return (
    <section aria-labelledby="what-h" style={{ background: 'var(--paper)' }}>
      <motion.div className="wrap" {...onView} variants={group}>
        <motion.h2 id="what-h" className="h2" style={{ marginBottom: 40, maxWidth: '14em' }} variants={rise}>
          Three things you no longer have to remember.
        </motion.h2>
        {REMEMBERED.map((r) => (
          <motion.div key={r.title} className="ledger" variants={rise}>
            <div>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
            </div>
            <p className="typed">{r.example}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}

function OrderSheet() {
  return (
    <motion.section id="orders" aria-labelledby="orders-h" className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 40 }} {...onView} variants={group}>
      <motion.div className="orders-head" variants={rise}>
        <h2 id="orders-h" className="h2" style={{ maxWidth: '13em' }}>
          Every order, read for what it asks of you.
        </h2>
        <p className="lede">Only filings and later orders count as proof. If you disagree, your call overrides the stamp.</p>
      </motion.div>
      <motion.div className="sheet ruled order-sheet" variants={group}>
        <motion.div className="order-sheet-head" variants={rise}>
          <span className="caps" style={{ fontSize: 18 }}>
            Order sheet
          </span>
          <span className="typed muted" style={{ fontSize: 14 }}>
            CS 412/2020, Court of the Civil Judge (Sr. Div.)
          </span>
        </motion.div>
        {ORDERS.map((o) => (
          <motion.div key={o.stamp} className="os" variants={rise}>
            <time>{o.date}</time>
            <span>{o.text}</span>
            <motion.span className="stamp" style={{ color: o.color, rotate: o.tilt }} variants={stampDown}>
              {o.stamp}
            </motion.span>
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
  )
}

function Ask() {
  return (
    <section id="ask" aria-labelledby="ask-h" className="wood">
      <motion.div className="wrap split" {...onView} variants={group}>
        <motion.div className="intro" variants={group}>
          <motion.h2 id="ask-h" className="h2" variants={rise}>
            Examine the record, not your memory.
          </motion.h2>
          <motion.p className="lede" style={{ maxWidth: '22em' }} variants={rise}>
            Ask in plain words. Every answer is marked with exhibits you can open.
          </motion.p>
          <MotionLink to="/app" className="btn start" style={{ marginTop: 8 }} variants={rise} {...press}>
            Try a question
          </MotionLink>
        </motion.div>
        <motion.div className="qa ruled" variants={group}>
          <motion.div className="qa-row" variants={rise}>
            <b>Q.</b>
            <span className="typed">Has Suresh Gupta contradicted himself anywhere?</span>
          </motion.div>
          <motion.div className="qa-row" variants={rise}>
            <b>A.</b>
            <span className="qa-answer">
              Yes. In 2021 he denied receiving the ₹5,00,000 <Ex n={1} />. In his 2023 affidavit he says he received it as a friendly loan <Ex n={2} />, and
              that he repaid ₹2,00,000 of it <Ex n={3} />.
            </span>
          </motion.div>
          <motion.ol className="exhibits" variants={group}>
            {EXHIBITS.map((source, i) => (
              <motion.li key={source} variants={rise}>
                Ex. {i + 1} {source}
              </motion.li>
            ))}
          </motion.ol>
        </motion.div>
      </motion.div>
    </section>
  )
}

function Verification() {
  return (
    <section aria-labelledby="ver-h" className="wrap" style={{ paddingBlock: 112 }}>
      <motion.div className="sheet ruled verification" {...onView} variants={rise}>
        <h2 id="ver-h" className="caps">
          Verification
        </h2>
        <p>
          Verified that Case Memory saves no quote that is not found word for word in its source. That it records a contradiction only when both statements
          cannot be true. That it treats only filings and orders as proof that a direction was followed. And that it never overrules a lawyer's own decision.
        </p>
        <footer>
          <span className="typed muted" style={{ fontSize: 14 }}>
            A memory aid for lawyers, not legal advice.
          </span>
          <span className="signature">
            <svg width="180" height="40" viewBox="0 0 180 40" fill="none" stroke="#1F3A7A" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <motion.path d="M8 28c14-20 22-22 20-6s10-18 18-10 4 14 14 4 12-10 18-2 10 6 20-4 18 2 30-2 18-6 26-4" variants={draw(0.5, 1.2)} />
            </svg>
            <span className="typed">Deponent</span>
          </span>
        </footer>
      </motion.div>
    </section>
  )
}

function Closing() {
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
        <motion.div className="credits" variants={rise}>
          <span>Built for Graph Hacks by WeMakeDevs and FalkorDB.</span>
          <span>Demo data is synthetic.</span>
        </motion.div>
      </motion.div>
    </footer>
  )
}

export default function LandingPage() {
  useEffect(() => {
    document.title = 'Case Memory: your case file, with a memory'
    return () => {
      document.title = 'Case Memory'
    }
  }, [])

  return (
    // "user": with reduced motion on, movement is skipped and only fades play.
    <MotionConfig reducedMotion="user">
      <div className="landing">
        <Hero />
        <Pipeline />
        <CauseList />
        <Remembered />
        <OrderSheet />
        <Ask />
        <Verification />
        <Closing />
      </div>
    </MotionConfig>
  )
}
