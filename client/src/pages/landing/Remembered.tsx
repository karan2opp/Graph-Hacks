import type { ReactNode } from 'react'
import { motion, type Variants } from 'motion/react'
import { EASE, draw, onView, rise, stamp, sweep } from './variants'

const TYPED = 'Courier Prime, monospace'
const INK = '#1B2430'
const MUTED = '#55606C'
const RED = '#A8231B'
const BLUE = '#1F3A7A'

/** Each card plays in on its own as it scrolls into view; side by side, they follow one another. */
const card: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: i * 0.12 } }),
}

/** A rubber stamp: double rule, typed capitals, set at an angle. */
function Stamp({ x, y, width, tilt, delay, color = RED, children }: { x: number; y: number; width: number; tilt: number; delay: number; color?: string; children: string }) {
  return (
    <motion.g style={{ rotate: tilt }} variants={stamp(delay)}>
      <rect x={x} y={y} width={width} height="26" rx="3" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x={x + 3} y={y + 3} width={width - 6} height="20" rx="2" fill="none" stroke={color} strokeWidth="1" />
      <text x={x + width / 2} y={y + 17.5} textAnchor="middle" fontFamily={TYPED} fontSize="12" fontWeight="700" letterSpacing="1.4" fill={color}>
        {children}
      </text>
    </motion.g>
  )
}

/** A statement slip pinned to the board. */
function Slip({ x, y, tilt, date, lines }: { x: number; y: number; tilt: number; date: string; lines: string[] }) {
  return (
    <motion.g variants={rise}>
      <g transform={`rotate(${tilt} ${x + 85} ${y + 31})`} fontFamily={TYPED}>
        <rect x={x} y={y} width="170" height="62" rx="2" fill="#FFFFFF" stroke="#B5C3B0" />
        <text x={x + 12} y={y + 19} fontSize="10" fill={MUTED}>{date}</text>
        {lines.map((line, i) => (
          <text key={line} x={x + 12} y={y + 37 + i * 16} fontSize="13" fill={INK}>{line}</text>
        ))}
      </g>
      <circle cx={x + 85} cy={y + 4} r="4.5" fill={RED} stroke="#6E140F" />
    </motion.g>
  )
}

/** Exhibit A: two statements by the same person, tied with red thread. */
function StorySpecimen() {
  return (
    <svg viewBox="0 0 300 190" role="img" aria-label="18 May 2021: denies receiving Rs. 5,00,000. 6 February 2023: received it as a friendly loan. Stamped: contradicts.">
      <Slip x={14} y={16} tilt={-2.5} date="18.05.2021 · WS p1" lines={['Denies receiving', 'Rs. 5,00,000']} />
      <Slip x={124} y={100} tilt={2} date="06.02.2023 · Aff. DW1" lines={['Received it as a', 'friendly loan']} />
      <motion.path d="M99 20 C 178 4, 250 58, 209 104" fill="none" stroke={RED} strokeWidth="2.4" strokeLinecap="round" variants={draw(0.6, 0.8)} />
      <Stamp x={6} y={140} width={108} tilt={-8} delay={1.3}>CONTRADICTS</Stamp>
    </svg>
  )
}

/** Exhibit B: a direction, its deadline on a timeline, and the days it has run over. */
function OrderSpecimen() {
  const mark = { fontFamily: TYPED, fontSize: 10.5 }
  return (
    <svg viewBox="0 0 300 190" role="img" aria-label="Order of 15 September 2026: plaintiff to file rejoinder within three weeks. Due 6 October; today is 17 October. Stamped: 11 days overdue.">
      <motion.g variants={rise} fontFamily={TYPED}>
        <text x="16" y="30" fontSize="10" fill={MUTED}>15.09.2026 · Order</text>
        <text x="16" y="52" fontSize="13.5" fill={INK}>Plaintiff to file rejoinder</text>
        <text x="16" y="70" fontSize="13.5" fill={INK}>within three weeks.</text>
      </motion.g>
      <g strokeLinecap="round">
        <motion.path d="M22 112 H 278" stroke="#C9D4C4" strokeWidth="4" variants={draw(0.3, 0.5)} />
        <motion.path d="M22 112 H 168" stroke={MUTED} strokeWidth="4" variants={draw(0.6, 0.6)} />
        <motion.path d="M168 112 H 278" stroke={RED} strokeWidth="4" variants={draw(1.2, 0.5)} />
      </g>
      <motion.g variants={rise}>
        <circle cx="22" cy="112" r="5" fill={MUTED} />
        <circle cx="168" cy="112" r="5" fill="#FFFFFF" stroke={MUTED} strokeWidth="2" />
        <circle cx="278" cy="112" r="5" fill={RED} />
        <text x="16" y="134" {...mark} fill={MUTED}>15 Sep</text>
        <text x="168" y="134" textAnchor="middle" {...mark} fill={MUTED}>Due 6 Oct</text>
        <text x="284" y="134" textAnchor="end" {...mark} fill={RED}>Today</text>
      </motion.g>
      <Stamp x={136} y={150} width={150} tilt={-5} delay={1.7}>11 DAYS OVERDUE</Stamp>
    </svg>
  )
}

/** Exhibit C: an answer's references, one opened at the cited paragraph. */
function SourceSpecimen() {
  const bars = (y: number, widths: number[], fill: string) =>
    widths.map((w, i) => <rect key={i} x="160" y={y + i * 12} width={w} height="5" rx="2.5" fill={fill} />)
  return (
    <svg viewBox="0 0 300 190" role="img" aria-label="An answer cites Written Statement page 1, paragraph 1, which opens with that paragraph highlighted, and the transcript of 19 July 2024, line 7.">
      <motion.g variants={rise} fontFamily={TYPED}>
        <text x="8" y="30" fontSize="12.5" fill={INK}>Denied in 2021</text>
        <rect x="8" y="44" width="106" height="26" rx="13" fill="#FFFFFF" stroke={RED} strokeWidth="1.5" />
        <text x="61" y="61" textAnchor="middle" fontSize="11" fontWeight="700" fill={RED}>WS · p1 ¶1</text>
        <rect x="8" y="122" width="110" height="26" rx="13" fill="#FFFFFF" stroke={BLUE} strokeWidth="1.5" />
        <text x="63" y="139" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={BLUE}>Hearing, line 7</text>
        <text x="63" y="166" textAnchor="middle" fontSize="10" fill={MUTED}>19.07.2024</text>
      </motion.g>
      <motion.g variants={rise}>
        <rect x="128" y="12" width="158" height="166" rx="2" fill="#FFFFFF" stroke="#B5C3B0" />
        <text x="140" y="32" fontFamily={TYPED} fontSize="8.5" letterSpacing="1" fill={MUTED}>WRITTEN STATEMENT</text>
        <text x="276" y="32" textAnchor="end" fontFamily={TYPED} fontSize="8.5" fill={MUTED}>p1</text>
        <motion.rect x="136" y="42" width="142" height="40" rx="2" fill="#F4D9D4" style={{ originX: 0 }} variants={sweep(0.9)} />
        <g fontFamily={TYPED} fontSize="11" fill={INK}>
          <text x="142" y="57">1.</text>
          <text x="142" y="101">2.</text>
          <text x="142" y="145">3.</text>
        </g>
        {bars(50, [108, 100, 64], '#8C96A2')}
        {bars(94, [108, 96, 80], '#D5DDD1')}
        {bars(138, [108, 72], '#D5DDD1')}
      </motion.g>
      <motion.path d="M114 57 C 122 57, 126 60, 134 60 M129 56 L 135 60 L 129 64" fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" variants={draw(0.6, 0.4)} />
    </svg>
  )
}

const THINGS: { exhibit: string; title: string; text: string; accent: string; specimen: ReactNode }[] = [
  {
    exhibit: 'A',
    title: 'Who changed their story',
    text: 'Every statement is compared with what the same person said before.',
    accent: 'var(--red)',
    specimen: <StorySpecimen />,
  },
  {
    exhibit: 'B',
    title: 'What the court ordered',
    text: 'Deadlines are read from each order and checked against what was filed.',
    accent: 'var(--blue)',
    specimen: <OrderSpecimen />,
  },
  {
    exhibit: 'C',
    title: 'Where it was said',
    text: 'Answers point to the page and paragraph, or the transcript line.',
    accent: 'var(--brass)',
    specimen: <SourceSpecimen />,
  },
]

/** "Three things": each one an exhibit card with a worked example that plays in. */
export function Remembered() {
  return (
    <section aria-labelledby="what-h" className="remembered">
      <div className="wrap">
        <motion.div className="remembered-head" {...onView} variants={rise}>
          <h2 id="what-h" className="h2" style={{ maxWidth: '14em' }}>
            Three things you no longer have to remember.
          </h2>
          <p className="lede">Case Memory keeps them for you, across every hearing and every filing.</p>
        </motion.div>
        <div className="things">
          {THINGS.map((thing, i) => (
            <motion.article
              key={thing.exhibit}
              className="thing"
              style={{ borderTopColor: thing.accent }}
              custom={i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.35 }}
              variants={card}
              whileHover={{ y: -4 }}
            >
              <span className="thing-label">Exhibit {thing.exhibit}</span>
              <div className="thing-specimen ruled">{thing.specimen}</div>
              <h3>{thing.title}</h3>
              <p>{thing.text}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
