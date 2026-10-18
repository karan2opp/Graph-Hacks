import { useEffect } from 'react'
import { Link } from 'react-router'
import { motion, MotionConfig } from 'motion/react'
import { CauseList } from './landing/CauseList'
import { Hero } from './landing/Hero'
import { Pipeline } from './landing/Pipeline'
import { OrderSheet } from './landing/Orders'
import { Remembered } from './landing/Remembered'
import { SiteFooter } from './landing/SiteChrome'
import { Verification } from './landing/Verification'
import { group, onView, press, rise } from './landing/variants'
import './landing/landing.css'

const EXHIBITS = ['Written Statement, p1 para 1', 'Affidavit of DW1, p1 para 1', 'Affidavit of DW1, p1 para 2']
const Ex = ({ n }: { n: number }) => <span className="ex">(Ex. {n})</span>

const MotionLink = motion.create(Link)

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
        <SiteFooter />
      </div>
    </MotionConfig>
  )
}
