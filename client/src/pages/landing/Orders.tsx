import { useState } from 'react'
import { motion } from 'motion/react'
import { group, onView, rise, stamp } from './variants'

type Tally = 'Overdue' | 'Due before the next hearing' | 'In force' | 'Complied' | 'Vacated'

/** Stamp colours follow the app: red overdue, blue in force, green complied, brown for the rest. */
const TALLIES: { name: Tally; color: string }[] = [
  { name: 'Overdue', color: 'var(--red)' },
  { name: 'Due before the next hearing', color: 'var(--brown)' },
  { name: 'In force', color: 'var(--blue)' },
  { name: 'Complied', color: 'var(--green)' },
  { name: 'Vacated', color: 'var(--muted)' },
]

/** How a direction reads: its stamp, where it counts, and the proof behind it. */
type Reading = { stamp: string; tally: Tally; color: string; proof: string }

/** Each direction as the agent read it, and as a lawyer might overrule it. */
const ORDERS: { date: string; text: string; tilt: number; agent: Reading; yours: Reading }[] = [
  {
    date: '10.03.2021',
    text: 'Defendant to file written statement within 30 days.',
    tilt: 2,
    agent: { stamp: 'FILED 39 DAYS LATE', tally: 'Complied', color: 'var(--brown)', proof: 'Written statement filed 18.05.2021; it was due 09.04.2021.' },
    yours: { stamp: 'DELAY CONDONED', tally: 'Complied', color: 'var(--green)', proof: 'Your call: the court condoned the delay.' },
  },
  {
    date: '02.11.2021',
    text: 'Parties to maintain status quo on the shop premises.',
    tilt: -2,
    agent: { stamp: 'IN FORCE', tally: 'In force', color: 'var(--blue)', proof: 'No later order has lifted it.' },
    yours: { stamp: 'VACATED', tally: 'Vacated', color: 'var(--muted)', proof: 'Your call: lifted by consent in court.' },
  },
  {
    date: '11.03.2025',
    text: 'Costs of Rs. 2,000 on the defendant.',
    tilt: 3,
    agent: { stamp: 'COMPLIED', tally: 'Complied', color: 'var(--green)', proof: 'Paid in court, as the order of 02.04.2025 records.' },
    yours: { stamp: 'NOT COMPLIED', tally: 'Overdue', color: 'var(--red)', proof: 'Your call: the payment never cleared.' },
  },
  {
    date: '15.09.2026',
    text: 'Plaintiff to file rejoinder within three weeks.',
    tilt: -4,
    agent: { stamp: 'OVERDUE', tally: 'Overdue', color: 'var(--red)', proof: 'No rejoinder on file; it was due 06.10.2026.' },
    yours: { stamp: 'FILED BY HAND', tally: 'Complied', color: 'var(--green)', proof: 'Your call: handed in at the counter on 05.10.2026.' },
  },
  {
    date: '15.09.2026',
    text: 'Defendant to produce original receipts by 22.10.2026.',
    tilt: 2,
    agent: { stamp: 'DUE 22 OCT', tally: 'Due before the next hearing', color: 'var(--brown)', proof: 'Due two days before the next hearing on 24.10.2026.' },
    yours: { stamp: 'PRODUCED', tally: 'Complied', color: 'var(--green)', proof: 'Your call: already handed to opposing counsel.' },
  },
]

/** A quick drop-in for text that changes after the section has played in. */
const swapIn = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } }

/** "Every order": the order sheet with its stamps, which the reader can overrule, and the tally they add up to. */
export function OrderSheet() {
  // Times each stamp has been clicked: odd means overruled. Only stamps that changed replay their stamp-down.
  const [flips, setFlips] = useState(() => ORDERS.map(() => 0))
  const readings = ORDERS.map((o, i) => (flips[i] % 2 ? o.yours : o.agent))
  const count = (tally: Tally) => readings.filter((r) => r.tally === tally).length

  return (
    <motion.section id="orders" aria-labelledby="orders-h" className="wrap orders" {...onView} variants={group}>
      <motion.div className="orders-head" variants={rise}>
        <h2 id="orders-h" className="h2" style={{ maxWidth: '13em' }}>
          Every order, read for what it asks of you.
        </h2>
        <p className="lede">Only filings and later orders count as proof. If you disagree, your call overrides the stamp.</p>
      </motion.div>

      <div className="orders-grid">
        <motion.div className="order-sheet" variants={group}>
          <motion.div className="order-sheet-head" variants={rise}>
            <span className="caps">Order sheet</span>
            <span className="typed">CS 412/2020, Court of the Civil Judge (Sr. Div.)</span>
          </motion.div>
          <motion.div className="os os-cols" aria-hidden="true" variants={rise}>
            <span>Date</span>
            <span>Direction</span>
            <span>Status</span>
          </motion.div>

          {ORDERS.map((o, i) => {
            const r = readings[i]
            const overruled = flips[i] % 2 === 1
            const changed = flips[i] > 0
            return (
              <motion.div key={i} className="os" variants={rise}>
                <time>{o.date}</time>
                <div>
                  <p className="os-direction">{o.text}</p>
                  <motion.p key={flips[i]} className={overruled ? 'os-proof mine' : 'os-proof'} {...(changed ? swapIn : {})}>
                    {r.proof}
                  </motion.p>
                </div>
                <motion.button
                  key={flips[i]}
                  type="button"
                  className="stamp"
                  style={{ color: r.color, rotate: o.tilt }}
                  variants={stamp(changed ? 0 : 0.35)}
                  {...(changed ? { initial: 'hidden', animate: 'show' } : {})}
                  aria-pressed={overruled}
                  title={overruled ? "Restore the agent's reading" : 'Overrule this stamp'}
                  onClick={() => setFlips((f) => f.map((n, j) => (j === i ? n + 1 : n)))}
                >
                  {r.stamp}
                </motion.button>
              </motion.div>
            )
          })}

          <motion.p className="os-hint" variants={rise}>
            Tap a stamp to overrule it. The agent's reading stays on record.
          </motion.p>
        </motion.div>

        <motion.aside className="docket" aria-label="At a glance" variants={rise}>
          <h3 className="caps">At a glance</h3>
          <ul className="docket-list" aria-live="polite">
            {TALLIES.map((t) => {
              const n = count(t.name)
              return (
                <li key={t.name} className={n ? undefined : 'none'}>
                  <motion.span key={n} className="docket-count" style={{ color: t.color }} {...swapIn}>
                    {n}
                  </motion.span>
                  <span>{t.name}</span>
                </li>
              )
            })}
          </ul>
          <p className="docket-next typed">Next hearing: Sat 24 Oct, cross of DW1</p>
        </motion.aside>
      </div>
    </motion.section>
  )
}
