import { useRef, useState } from 'react'
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { CaseFile } from './scene/CaseFile'
import { PaperRibbon } from './scene/PaperRibbon'
import { MachineSlot, Processor } from './scene/Processor'
import { TypingBack, TypingFront } from './scene/TypingDesk'
import { VIEW_H, VIEW_W, useClock } from './scene/core'

const STEPS = [
  'The stenographer types every word said in court.',
  'The transcript feeds straight into Case Memory.',
  'Its agents pin each statement to who said it and what it is about.',
  'Two statements that cannot both be true are tied with red thread.',
]
/** Which step the reader is on, from the part of the scene at the middle of the screen. */
const stepAt = (c: number) => (c < 440 ? 0 : c < 900 ? 1 : c < 1095 ? 2 : 3)

/**
 * "How it works": the steps stay on the left while the scene runs down the right, from the
 * typewriter, along the paper, through the machine, into the case file. Typing, the paper and the
 * machine run on a loop; each part plays in as the reader scrolls down to it.
 */
export function Pipeline() {
  const scene = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: scene, offset: ['start center', 'end center'] })
  const finished = useMotionValue(1)
  // With reduced motion the scene is shown finished and still.
  const progress = reduced ? finished : scrollYProgress
  const c = useTransform(progress, (v) => v * VIEW_H)
  const t = useClock(scene, Boolean(reduced))

  const [active, setActive] = useState(() => stepAt(c.get()))
  useMotionValueEvent(c, 'change', (v) => setActive(stepAt(v)))

  return (
    <section id="pipeline" className="pipeline" aria-labelledby="pipe-h">
      <div className="pipeline-inner">
        <div className="pipeline-text">
          <h2 id="pipe-h" className="h2">
            From the stenographer's typewriter to your brief.
          </h2>
          <p className="lede">The transcript of every hearing goes straight into Case Memory, and comes out as a record you can work from.</p>
          <ol className="steps">
            {STEPS.map((text, i) => (
              <li key={i} data-step={i} className={i < active ? 'step done' : 'step'} aria-current={i === active ? 'step' : undefined}>
                <span className="step-dot">{i + 1}</span>
                <span>{text}</span>
                {i < STEPS.length - 1 && (
                  <span className="step-rail" aria-hidden="true">
                    <motion.span initial={false} animate={{ scaleY: i < active ? 1 : 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="pipeline-scene" ref={scene}>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label="A stenographer types a hearing on a typewriter. The typed paper flows down into the Case Memory machine, whose AI reads it; what it finds lands in the case file, where two contradicting statements are tied with red thread and flagged."
          >
            <TypingBack t={t} />
            <MachineSlot />
            <PaperRibbon t={t} c={c} />
            <TypingFront t={t} />
            <Processor t={t} c={c} />
            <CaseFile t={t} c={c} />
          </svg>
        </div>
      </div>
    </section>
  )
}
