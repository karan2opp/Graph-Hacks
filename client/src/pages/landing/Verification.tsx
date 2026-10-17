import { motion } from 'motion/react'
import { draw, group, onView, rise, stamp } from './variants'

/** What the agents swear to, each with a short lead. */
const PROMISES: [string, string][] = [
  ['No invented quotes.', 'Case Memory saves no quote that is not found word for word in its source.'],
  ['No loose contradictions.', 'It records a contradiction only when both statements cannot be true.'],
  ['Only the record as proof.', 'It treats only filings and orders as proof that a direction was followed.'],
  ['Your call stands.', "It never overrules a lawyer's own decision."],
]

/** "17th day of October 2026", the way a verification is dated. */
const SWORN_ON = (() => {
  const now = new Date()
  const d = now.getDate()
  const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `${d}${suffix} day of ${now.toLocaleString('en-GB', { month: 'long' })} ${now.getFullYear()}`
})()

/** A round notary-style seal, its legend running round the rim. */
function Seal() {
  return (
    <motion.svg className="seal" viewBox="0 0 120 120" aria-hidden="true" style={{ rotate: -14 }} variants={stamp(1.6)}>
      <circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path id="seal-ring" d="M60 60 m -48.5 0 a 48.5 48.5 0 1 1 97 0 a 48.5 48.5 0 1 1 -97 0" fill="none" />
      <text fontFamily="Courier Prime, monospace" fontSize="9" fontWeight="700" fill="currentColor">
        <textPath href="#seal-ring" textLength="300" lengthAdjust="spacing">
          CASE MEMORY · VERIFIED · CASE MEMORY · VERIFIED ·
        </textPath>
      </text>
      {/* The Case Memory mark in the middle */}
      <g transform="translate(43 43) scale(1.2)" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="6" cy="7" r="3" />
        <circle cx="22" cy="7" r="3" />
        <circle cx="14" cy="21" r="3" />
        <path d="M8.5 9l4 9.5M19.5 9l-4 9.5M9 7h10" />
      </g>
    </motion.svg>
  )
}

/** "Verification": the agents' promises, set out like the verification at the end of a pleading. */
export function Verification() {
  return (
    <section aria-labelledby="ver-h" className="wrap" style={{ paddingBlock: 112 }}>
      <div className="affidavit-stack">
        <motion.div className="affidavit" {...onView} variants={group}>
          <motion.header className="affidavit-head" variants={rise}>
            <h2 id="ver-h" className="caps">
              Verification
            </h2>
            <p className="typed">Sworn by the agents of Case Memory</p>
          </motion.header>

          <ol className="promises">
            {PROMISES.map(([lead, text], i) => (
              <motion.li key={lead} variants={rise}>
                <span className="typed">{i + 1}.</span>
                <p>
                  <b>{lead}</b> {text}
                </p>
              </motion.li>
            ))}
          </ol>

          <motion.p className="affidavit-clause" variants={rise}>
            Verified on this {SWORN_ON} that the contents of paragraphs 1 to 4 above are true and correct to the best of our knowledge and belief,
            and that nothing material has been concealed.
          </motion.p>

          <motion.footer className="affidavit-foot" variants={rise}>
            <span className="typed">A memory aid for lawyers, not legal advice.</span>
            <div className="signature">
              <Seal />
              <svg viewBox="0 0 200 56" fill="none" stroke="#1F3A7A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <motion.path
                  d="M12 42 C 20 22, 30 10, 34 22 S 34 48, 46 34 S 60 12, 66 26 S 70 44, 82 30 S 98 16, 104 28 C 108 36, 116 36, 124 28 S 150 18, 188 22"
                  variants={draw(0.4, 1.3)}
                />
              </svg>
              <span className="signature-line typed">Deponent</span>
              <span className="signature-name typed">for Case Memory</span>
            </div>
          </motion.footer>
        </motion.div>
      </div>
    </section>
  )
}
