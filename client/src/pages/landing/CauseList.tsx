import { Link } from 'react-router'
import { motion, type Variants } from 'motion/react'
import { Logo } from '../../components/TopBar'
import { EASE, group, onView, rise } from './variants'

type Tone = 'red' | 'green' | 'blue'
type Note = { tone: Tone; lead: string; text?: string }

/** The week's board, by hearing date; each matter carries the notes Case Memory stuck on it. */
const DAYS: { date: string; court: string; matters: { item: number; title: string; number: string; listedFor: string; notes: Note[] }[] }[] = [
  {
    date: 'Saturday, 24 October 2026',
    court: 'Civil Judge (Sr. Div.), Court No. 4',
    matters: [
      {
        item: 7,
        title: 'Ramesh Kumar v. Suresh Gupta',
        number: 'CS 412/2020',
        listedFor: 'Cross-examination of DW1',
        notes: [
          { tone: 'red', lead: 'Rejoinder 11 days late', text: 'was due 06.10.2026' },
          { tone: 'red', lead: '3 contradictions', text: 'ready for cross' },
        ],
      },
      {
        item: 8,
        title: 'Suresh Gupta v. Ramesh Kumar',
        number: 'CS 98/2022',
        listedFor: 'Evidence',
        notes: [
          { tone: 'green', lead: 'Nothing pending' },
          { tone: 'blue', lead: 'Linked', text: 'to item 7' },
        ],
      },
    ],
  },
  {
    date: 'Thursday, 5 November 2026',
    court: 'District Consumer Commission, Bench 2',
    matters: [
      {
        item: 3,
        title: 'Meera Iyer v. Coastal Builders',
        number: 'CC 88/2023',
        listedFor: 'Arguments',
        notes: [{ tone: 'red', lead: '₹5,000 costs unpaid', text: 'by the opposite party' }],
      },
    ],
  },
]

const MATTERS = DAYS.flatMap((d) => d.matters)
const NEED_ATTENTION = MATTERS.filter((m) => m.notes.some((n) => n.tone === 'red')).length

/** Each flag is stuck on after its matter appears, the next a beat later. */
const stickOn = (i: number): Variants => ({
  hidden: { opacity: 0, x: -18, rotate: -3 },
  show: { opacity: 1, x: 0, rotate: i % 2 ? 1 : -1, transition: { delay: 0.35 + i * 0.15, duration: 0.45, ease: EASE } },
})

/** "Your cause list": the week's printed list, with Case Memory's notes flagged on each matter. */
export function CauseList() {
  return (
    <motion.section id="cause" aria-labelledby="cause-h" className="wrap causes" {...onView} variants={group}>
      <motion.div className="causes-head" variants={rise}>
        <h2 id="cause-h" className="h2" style={{ maxWidth: '12em' }}>
          Your cause list, already annotated.
        </h2>
        <div className="causes-intro">
          <p className="lede">Before each date, every matter on your board tells you what is late, what is due, and what to raise.</p>
          <Link className="more" to="/app">
            See a case brief
          </Link>
        </div>
      </motion.div>

      <div className="cause-doc">
        <motion.div className="cause-paper" variants={group}>
          <motion.header className="cause-top" variants={rise}>
            <div className="cause-title">
              <svg width="30" height="26" viewBox="0 0 36 30" fill="none" stroke="#5B4A2A" strokeWidth="1.6" aria-hidden="true">
                <path d="M18 2v26M8 28h20M4 8h28" />
                <path d="M4 8l-3 9h6zM32 8l-3 9h6z" />
                <path d="M1 17a3 3 0 006 0M29 17a3 3 0 006 0" />
              </svg>
              <div>
                <span className="caps">Cause list</span>
                <span className="typed">Matters of Adv. Kavita Rao, week of 19 October 2026</span>
              </div>
            </div>
            <span className="cause-badge">
              <Logo size={16} />
              Annotated by Case Memory
            </span>
          </motion.header>

          {DAYS.map((day) => (
            <div key={day.date}>
              <motion.div className="cause-day" variants={rise}>
                <span>{day.date}</span>
                <span>{day.court}</span>
              </motion.div>
              {day.matters.map((m) => (
                <motion.article key={m.item} className="cause-row" variants={rise}>
                  <span className="cause-item typed">{m.item}</span>
                  <div className="cause-matter">
                    <h3>{m.title}</h3>
                    <span className="typed">{m.number}</span>
                  </div>
                  <div className="cause-listed">
                    <span>Listed for</span>
                    {m.listedFor}
                  </div>
                  <ul className="cause-flags" aria-label={`Case Memory's notes on item ${m.item}`}>
                    {m.notes.map((n, i) => (
                      <motion.li key={n.lead} className={`flag ${n.tone}`} variants={stickOn(i)}>
                        <b>{n.lead}</b>
                        {n.text && <span> {n.text}</span>}
                      </motion.li>
                    ))}
                  </ul>
                </motion.article>
              ))}
            </div>
          ))}

          <motion.footer className="cause-foot typed" variants={rise}>
            {MATTERS.length} matters this fortnight · {NEED_ATTENTION} need your attention before the date
          </motion.footer>
        </motion.div>
      </div>
    </motion.section>
  )
}
