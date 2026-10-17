import type { RefObject } from 'react'
import { useAnimationFrame, useInView, useMotionValue, type MotionValue } from 'motion/react'

export type Value = MotionValue<number>

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** The scene's size in SVG units. Scroll position is measured in the same units (see `c` in shared.tsx). */
export const VIEW_W = 640
export const VIEW_H = 1430

/** Seconds since the scene mounted. Ticks only while it is on screen, and never with reduced motion. */
export function useClock(ref: RefObject<Element | null>, still: boolean): Value {
  const t = useMotionValue(0)
  const visible = useInView(ref)
  useAnimationFrame((ms) => {
    if (visible && !still) t.set(ms / 1000)
  })
  return t
}

/* ---------- the typing rhythm: everything that types is driven from these ---------- */

/** One typed line per loop: ten keystrokes, then the carriage returns and the paper feeds a line. */
export const LOOP = 2.4
const STRIKES = [0.08, 0.3, 0.47, 0.72, 0.9, 1.12, 1.3, 1.55, 1.74, 1.93]
const HIT = 0.14
const RETURN = [2.02, 2.34] as const
/** Which typebar and key each keystroke uses, varied so nothing moves in lockstep. */
export const BAR = [0, 2, 1, 3, 1, 0, 2, 3, 0, 1]
export const KEY = [1, 3, 0, 2, 1, 3, 2, 0, 3, 1]
/** Keys 0-1 sit under the near hand (0), keys 2-3 under the far hand (1). */
export const HAND = KEY.map((k) => (k < 2 ? 0 : 1))

const loopTime = (t: number) => t % LOOP
const bump = (dt: number) => (dt >= 0 && dt < HIT ? Math.sin((Math.PI * dt) / HIT) : 0)
const returning = (t: number) => ease(clamp((loopTime(t) - RETURN[0]) / (RETURN[1] - RETURN[0])))

/** 0 at rest, 1 at impact, for the keystrokes assigned to `which` (a bar, key or hand). */
export function struck(t: number, pick: number[], which: number) {
  const u = loopTime(t)
  let v = 0
  for (let i = 0; i < STRIKES.length; i++) if (pick[i] === which) v = Math.max(v, bump(u - STRIKES[i]))
  return v
}

/** Share of the current line typed so far. */
export const typedShare = (t: number) => STRIKES.filter((s) => loopTime(t) >= s + HIT / 2).length / STRIKES.length

/** Carriage shift in SVG units: a notch left per keystroke, sliding back on the return. */
export function carriageShift(t: number) {
  const u = loopTime(t)
  const notches = STRIKES.reduce((n, s) => n + clamp((u - s - HIT / 2) / 0.05), 0)
  return -3 * notches * (1 - returning(t))
}

/** Lines fed through so far: the paper moves up one line during each return. */
export const linesFed = (t: number) => Math.floor(t / LOOP) + returning(t)

/** A short pulse while the paper feeds, which is also when a line reaches the machine. */
export const feedPulse = (t: number) => Math.sin(Math.PI * clamp((loopTime(t) - RETURN[0]) / 0.36))

/* ---------- geometry ---------- */

export type Pt = [number, number]

/** A point a share `u` of the way along a polyline. */
export function along(pts: Pt[], u: number): Pt {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  let d = u * lens.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? Math.min(1, d / lens[i]) : 0
      return [pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1])]
    }
    d -= lens[i]
  }
  return pts[pts.length - 1]
}
