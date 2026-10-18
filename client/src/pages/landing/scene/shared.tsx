import type { ReactNode } from 'react'
import { motion, useTransform } from 'motion/react'
import type { Value } from './core'

/* ---------- scroll reveals ---------- */

/**
 * `c` is the point of the scene at the middle of the screen, in SVG units: 0 at the top of the
 * scene, VIEW_H at the bottom. Each part plays in as the reader's eye reaches it.
 */
export function Appear({ c, at, children }: { c: Value; at: number; children: ReactNode }) {
  const opacity = useTransform(c, [at, at + 40], [0, 1])
  const y = useTransform(opacity, [0, 1], [10, 0])
  return <motion.g style={{ opacity, y }}>{children}</motion.g>
}

/** A line that draws itself as the reader's eye moves from `at` to `at + span`. */
export function Draw(props: { c: Value; at: number; span?: number; d: string; stroke: string; strokeWidth: number }) {
  const { c, at, span = 60, ...path } = props
  const pathLength = useTransform(c, [at, at + span], [0, 1])
  // A zero-length dash still shows a dot with round caps, so stay hidden until drawing starts.
  const opacity = useTransform(pathLength, (v) => (v > 0 ? 1 : 0))
  return <motion.path {...path} fill="none" style={{ pathLength, opacity }} />
}

/** Rotates its children about (x, y) in the parent's coordinates, like SVG's rotate(a x y). */
export function Pivot({ x, y, rotate, children }: { x: number; y: number; rotate: Value; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.g style={{ rotate, transformBox: 'view-box', originX: '0px', originY: '0px' }}>{children}</motion.g>
    </g>
  )
}
