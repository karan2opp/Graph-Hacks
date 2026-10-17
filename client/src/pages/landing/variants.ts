import type { Variants } from 'motion/react'

/* Entrance animations shared by the landing page's sections (motion/react variants). */

export const EASE = [0.2, 0.7, 0.2, 1] as const

/** Children play their own entrance one after another. */
export const group: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
export const rise: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }
export const drop: Variants = { hidden: { opacity: 0, y: -28 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 180, damping: 20 } } }

/** A line drawing itself. Hidden until it starts: a zero-length round cap still shows a dot. */
export const draw = (delay: number, duration: number): Variants => ({
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { delay, duration, ease: [0.6, 0, 0.2, 1], opacity: { delay, duration: 0.01 } } },
})

/** A rubber stamp coming down on the page. */
export const stamp = (delay: number): Variants => ({
  hidden: { opacity: 0, scale: 1.8 },
  show: { opacity: 0.88, scale: 1, transition: { delay, type: 'spring', stiffness: 500, damping: 18 } },
})

/** A highlighter pass from left to right (set originX to 0 on the element). */
export const sweep = (delay: number): Variants => ({
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { delay, duration: 0.7, ease: EASE } },
})

/** Plays an entrance once, when it scrolls into view. */
export const onView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, amount: 0.2 } } as const

/** Buttons lift on hover and give on press. */
export const press = { whileHover: { y: -2 }, whileTap: { scale: 0.97 } } as const
