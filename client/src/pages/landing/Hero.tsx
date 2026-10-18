import { Link } from 'react-router'
import { motion, type Variants } from 'motion/react'
import { SiteHeader } from './SiteChrome'
import { draw, drop, group, press, rise, sweep } from './variants'

const MotionLink = motion.create(Link)

const TYPED = 'Courier Prime, monospace'
const CHAR = 9.6 // Courier Prime is monospaced: 0.6em a character at 16px, so highlights can be sized to the words
const LINE = 26

/** The sample case's numbers (see the seed). */
const FACTS = [
  { label: 'hearings', value: 10 },
  { label: 'documents', value: 12 },
  { label: 'contradictions', value: 3 },
]

const pop = (delay: number): Variants => ({
  hidden: { opacity: 0, scale: 0.4 },
  show: { opacity: 1, scale: 1, transition: { delay, type: 'spring', stiffness: 420, damping: 16 } },
})

type Pt = { x: number; y: number }
/** A point on a slip after the slip is tilted about its centre. */
const tilted = (p: Pt, c: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A statement slip: source, page and paragraph, then the words, with the contested part highlighted. */
type Slip = { x: number; y: number; w: number; tilt: number; source: string; lines: { text: string; mark?: [number, number] }[]; markAt: number }
const slipHeight = (s: Slip) => 68 + LINE * s.lines.length
const slipCentre = (s: Slip): Pt => ({ x: s.x + s.w / 2, y: s.y + slipHeight(s) / 2 })

const WRITTEN: Slip = {
  x: 150, y: 72, w: 368, tilt: -1.4, markAt: 0.9,
  source: 'Written Statement · 18.05.2021',
  lines: [
    { text: '1. The defendant denies having', mark: [17, 13] },
    { text: 'received any payment of', mark: [0, 23] },
    { text: 'Rs. 5,00,000 from the plaintiff.', mark: [0, 12] },
  ],
}
const AFFIDAVIT: Slip = {
  x: 96, y: 272, w: 372, tilt: 1.2, markAt: 1.25,
  source: 'Affidavit of DW1 · 06.02.2023',
  lines: [
    { text: '1. I received the said amount', mark: [5, 24] },
    { text: 'in March 2019 as a friendly loan.', mark: [0, 32] },
  ],
}

/** Pins sit on each slip's left edge, beside the contested words, so the thread runs in the folder's margin. */
const PIN_1 = tilted({ x: WRITTEN.x, y: WRITTEN.y + 70 + LINE - 4 }, slipCentre(WRITTEN), WRITTEN.tilt)
const PIN_2 = tilted({ x: AFFIDAVIT.x, y: AFFIDAVIT.y + 70 - 4 }, slipCentre(AFFIDAVIT), AFFIDAVIT.tilt)
const MID_Y = (PIN_1.y + PIN_2.y) / 2
const THREAD = `M${PIN_1.x} ${PIN_1.y} C ${PIN_1.x - 62} ${PIN_1.y + 2}, 48 ${MID_Y - 44}, 52 ${MID_Y} S ${PIN_2.x - 36} ${PIN_2.y}, ${PIN_2.x} ${PIN_2.y}`

function StatementSlip({ slip }: { slip: Slip }) {
  const h = slipHeight(slip)
  const c = slipCentre(slip)
  const left = slip.x + 24, right = slip.x + slip.w - 24
  return (
    <motion.g variants={drop}>
      <g transform={`rotate(${slip.tilt} ${c.x} ${c.y})`}>
        <rect x={slip.x} y={slip.y} width={slip.w} height={h} rx="3" fill="#FBFCF9" filter="url(#hero-shadow)" />
        <text x={left} y={slip.y + 30} fontFamily={TYPED} fontSize="12" fill="#55606C">{slip.source}</text>
        <text x={right} y={slip.y + 30} textAnchor="end" fontFamily={TYPED} fontSize="12" fill="#55606C">p1 ¶1</text>
        <line x1={left} x2={right} y1={slip.y + 42} y2={slip.y + 42} stroke="#C9D4C4" />
        {slip.lines.map((l, i) => {
          const base = slip.y + 70 + i * LINE
          return (
            <g key={l.text}>
              <line x1={left} x2={right} y1={base + 9} y2={base + 9} stroke="#E4EAE0" />
              {l.mark && (
                <motion.rect
                  x={left + l.mark[0] * CHAR - 2}
                  y={base - 14}
                  width={l.mark[1] * CHAR + 4}
                  height="20"
                  rx="2"
                  fill="#F4D9D4"
                  style={{ originX: 0 }}
                  variants={sweep(slip.markAt + i * 0.18)}
                />
              )}
              <text x={left} y={base} fontFamily={TYPED} fontSize="16" fill="#1B2430">{l.text}</text>
            </g>
          )
        })}
      </g>
    </motion.g>
  )
}

/** The case file: two statements by the same person, pinned and tied with red thread. */
function CaseFileArt() {
  return (
    <svg viewBox="0 0 560 520" role="img" aria-label="A case file where a red thread ties a 2021 denial of receiving Rs. 5,00,000 to a 2023 admission, by the same person">
      <defs>
        <filter id="hero-shadow" x="-10%" y="-10%" width="120%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#1A0C07" floodOpacity="0.3" />
        </filter>
      </defs>

      <g transform="rotate(-1.5 280 260)">
        {/* Folder: back with its tab, papers, and the front pocket */}
        <motion.g variants={rise}>
          <rect x="44" y="18" width="150" height="40" rx="8" fill="#CDB886" />
          <text x="64" y="35" fontFamily={TYPED} fontSize="13" fill="#5B4A2A">CS 412/2020</text>
          <rect x="20" y="40" width="520" height="456" rx="10" fill="#D8C496" stroke="#C2AB78" filter="url(#hero-shadow)" />
        </motion.g>

        <StatementSlip slip={WRITTEN} />
        <motion.path d="M424 58 v 36 a 7 7 0 0 0 14 0 v -30 a 4.5 4.5 0 0 0 -9 0 v 26" fill="none" stroke="#8E9AA6" strokeWidth="2.2" strokeLinecap="round" variants={drop} />
        <StatementSlip slip={AFFIDAVIT} />

        <motion.path d="M20 446 L 540 428 L 540 486 Q 540 496 530 496 L 30 496 Q 20 496 20 486 Z" fill="#CFB984" variants={rise} />

        {/* Same person, two stories: tied with red thread */}
        <motion.path d={THREAD} fill="none" stroke="#C42D22" strokeWidth="2.6" strokeLinecap="round" variants={draw(1.5, 1.1)} />
        {[PIN_1, PIN_2].map((p, i) => (
          <motion.circle key={i} cx={p.x} cy={p.y} r="5.5" fill="#C42D22" stroke="#7A150F" strokeWidth="1.2" variants={pop(1.35 + i * 0.12)} />
        ))}
        <motion.g style={{ rotate: -2.5 }} variants={pop(2.4)}>
          <rect x="128" y="230" width="264" height="30" rx="3" fill="#A8231B" filter="url(#hero-shadow)" />
          <text x="260" y="250" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="14" fontWeight="600" fill="#FFFFFF">
            Same person. Can't both be true.
          </text>
        </motion.g>
      </g>

      {/* Gavel resting on the pocket */}
      <motion.g variants={rise}>
        <g transform="translate(382 420) scale(0.7)">
        <ellipse cx="80" cy="104" rx="66" ry="10" fill="rgba(0,0,0,0.3)" />
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
        </g>
      </motion.g>
    </svg>
  )
}

export function Hero() {
  return (
    <section className="wood" aria-labelledby="hero">
      <SiteHeader />

      <motion.div className="hero" initial="hidden" animate="show" variants={group}>
        <motion.div className="hero-copy" variants={group}>
          <motion.span className="caps kicker" variants={rise}>
            In the matter of every hearing you've had
          </motion.span>
          <motion.h1 id="hero" variants={rise}>
            Your case file, with a <em>memory</em>.
          </motion.h1>
          <motion.p className="lede" variants={rise}>
            Add hearings, orders and filings. It catches changed stories, tracks what the court ordered, and answers with the exact paragraph.
          </motion.p>
          <motion.div className="hero-actions" variants={rise}>
            <MotionLink className="btn" to="/app" {...press}>
              Open the sample case
            </MotionLink>
            <a className="hero-more" href="/#pipeline">
              See how it works <span aria-hidden="true">→</span>
            </a>
          </motion.div>
          <motion.div className="hero-facts" variants={rise}>
            <dl>
              {FACTS.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            <p className="typed">In the sample case, CS 412/2020 (synthetic)</p>
          </motion.div>
        </motion.div>

        <motion.figure className="case-file" variants={group}>
          <CaseFileArt />
        </motion.figure>
      </motion.div>
      <div className="brass-strip" />
    </section>
  )
}
