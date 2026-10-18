import { motion, useTransform } from 'motion/react'
import { feedPulse, along, type Pt, type Value } from './core'
import { Pivot } from './shared'

const CHIP = { x: 380, y: 886 }

/** Circuit traces from the chip's edges to the nodes; the last point of each is its node. */
const TRACES: Pt[][] = [
  [[348, 870], [318, 870], [318, 836]],
  [[348, 902], [300, 902], [300, 936]],
  [[412, 870], [446, 870], [446, 834]],
  [[412, 902], [462, 902], [462, 940]],
  [[372, 854], [372, 826], [340, 826]],
  [[388, 918], [388, 946], [420, 946]],
  [[388, 854], [388, 824], [420, 824]],
  [[372, 918], [372, 948], [336, 948]],
]
const STUBS = 'M318 836 H 284 M300 936 H 280 M446 834 H 478 M462 940 H 480 M340 826 V 814 M420 946 V 958'
const tracePath = (pts: Pt[]) => `M${pts.map((p) => p.join(' ')).join('L')}`


const wrap = (v: number) => ((v % 1) + 1) % 1

/** Nodes light one after another around the board while the machine is working. */
function Node({ t, on, index }: { t: Value; on: Value; index: number }) {
  const [x, y] = TRACES[index][TRACES[index].length - 1]
  const glow = useTransform([t, on], ([tv, k]: number[]) => {
    const u = wrap(tv / 2.4 - index / TRACES.length)
    return k * (u < 0.22 ? Math.sin((Math.PI * u) / 0.22) : 0)
  })
  const opacity = useTransform(glow, (g) => 0.35 + 0.65 * g)
  const scale = useTransform(glow, (g) => 1 + 0.6 * g)
  const halo = useTransform(glow, (g) => 0.45 * g)
  const fill = index % 2 ? '#7CD3A0' : '#E2BE62'
  return (
    <>
      <motion.circle cx={x} cy={y} r="9" fill={fill} style={{ opacity: halo }} />
      <motion.circle cx={x} cy={y} r="4" fill={fill} style={{ opacity, scale }} />
    </>
  )
}

/** A gold spark running out along a trace: the content being worked on. */
function Spark({ t, on, trace, offset }: { t: Value; on: Value; trace: number; offset: number }) {
  const pos = useTransform(t, (v) => along(TRACES[trace], wrap(v / 1.6 + offset)))
  const x = useTransform(pos, (p) => p[0])
  const y = useTransform(pos, (p) => p[1])
  return <motion.circle cx="0" cy="0" r="2.6" fill="#F4D58A" style={{ x, y, opacity: on }} />
}

function Light({ t, cy, color, phase }: { t: Value; cy: number; color: string; phase: number }) {
  const opacity = useTransform(t, (v) => 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((2 * Math.PI * v) / 1.4 + phase)))
  return <motion.circle cx="528" cy={cy} r="4.5" fill={color} style={{ opacity }} />
}

/** The opening the paper goes into. Drawn behind the paper, so the paper passes into it. */
export function MachineSlot() {
  return <rect x="332" y="772" width="96" height="16" rx="4" fill="#1B2430" />
}

/** Case Memory's machine: it takes in the transcript and its circuits light up as it reads. */
export function Processor({ t, c }: { t: Value; c: Value }) {
  // Working once the paper has reached the slot.
  const on = useTransform(c, [740, 800], [0, 1])
  const pulse = useTransform([t, on], ([tv, k]: number[]) => k * feedPulse(tv))
  const chipScale = useTransform(pulse, (p) => 1 + 0.06 * p)
  const chipGlow = useTransform([on, pulse], ([k, p]: number[]) => 0.1 * k + 0.3 * p)
  const sway = useTransform(t, (v) => 2.5 * Math.sin(v * 0.9))

  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <line x1="170" y1="1008" x2="600" y2="1008" stroke="#AEBDA9" strokeWidth="2" />

      {/* Plant */}
      <Pivot x={208} y={962} rotate={sway}>
        <path d="M0 0 C -6 -20, -24 -40, -36 -46 C -32 -30, -18 -12, 0 0 Z" fill="#3E7D5A" />
        <path d="M0 0 C 8 -20, 22 -38, 38 -42 C 32 -26, 16 -10, 0 0 Z" fill="#3E7D5A" />
        <path d="M0 0 C 2 -24, -2 -50, -12 -68 C -16 -46, -8 -20, 0 0 Z" fill="#2F6B4A" />
        <path d="M0 0 C 6 -26, 16 -46, 14 -64 C 2 -46, -2 -24, 0 0 Z" fill="#4E9268" />
      </Pivot>
      <path d="M188 966 L 228 966 L 222 1008 L 194 1008 Z" fill="#EFE6D2" stroke="#1B2430" strokeWidth="1.5" />
      <rect x="184" y="959" width="48" height="9" rx="2" fill="#E3D8BF" stroke="#1B2430" strokeWidth="1.5" />

      {/* Housing */}
      <rect x="506" y="796" width="44" height="194" rx="14" fill="#E2D8BF" stroke="#1B2430" strokeWidth="2" />
      <rect x="240" y="782" width="280" height="218" rx="26" fill="#F3ECD9" stroke="#1B2430" strokeWidth="2" />
      <path d="M266 790 H 494" stroke="#FFFFFF" strokeWidth="2" opacity="0.7" />
      <Light t={t} cy={840} color="#3E8E63" phase={0} />
      <Light t={t} cy={862} color="#D9A93F" phase={2} />
      <Light t={t} cy={884} color="#3E8E63" phase={4} />
      <rect x="262" y="1000" width="34" height="8" rx="2" fill="#1B2430" />
      <rect x="464" y="1000" width="34" height="8" rx="2" fill="#1B2430" />
      <rect x="330" y="969" width="100" height="14" rx="2" fill="#C9A464" />
      <text x="380" y="979" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="7.5" fontWeight="600" letterSpacing="1.4" fill="#2A1711">
        CASE MEMORY
      </text>
      <rect x="340" y="988" width="80" height="6" rx="2" fill="#1B2430" />

      {/* Screen with the circuit board */}
      <rect x="264" y="806" width="232" height="158" rx="14" fill="#1F4A3B" />
      <rect x="270" y="812" width="220" height="146" rx="10" fill="none" stroke="#2F6B50" strokeWidth="1.5" />
      <path d={STUBS} fill="none" stroke="#2F6B50" strokeWidth="2" />
      {TRACES.map((pts, i) => (
        <path key={i} d={tracePath(pts)} fill="none" stroke="#3E6B57" strokeWidth="2" />
      ))}
      {TRACES.map((pts, i) => (
        <motion.path key={i} d={tracePath(pts)} fill="none" stroke="#D9B45A" strokeWidth="2" style={{ pathLength: on, opacity: on }} />
      ))}
      <motion.circle cx={CHIP.x} cy={CHIP.y} r="52" fill="#7CE0A6" style={{ opacity: chipGlow }} />
      <motion.g style={{ scale: chipScale }}>
        <path
          d="M358 850 V 854 M370 850 V 854 M390 850 V 854 M402 850 V 854 M358 918 V 922 M370 918 V 922 M390 918 V 922 M402 918 V 922 M344 864 H 348 M344 876 H 348 M344 896 H 348 M344 908 H 348 M412 864 H 416 M412 876 H 416 M412 896 H 416 M412 908 H 416"
          stroke="#9AD9B4"
          strokeWidth="1.6"
        />
        <rect x="348" y="854" width="64" height="64" rx="9" fill="#2F7A57" stroke="#9AD9B4" strokeWidth="1.6" />
        <text x={CHIP.x} y={CHIP.y + 9} textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="25" fontWeight="700" fill="#EAF5EE">
          AI
        </text>
      </motion.g>
      {TRACES.map((_, i) => (
        <Node key={i} t={t} on={on} index={i} />
      ))}
      {[0, 2, 5, 7].map((trace, i) => (
        <Spark key={trace} t={t} on={on} trace={trace} offset={i / 4} />
      ))}
    </g>
  )
}
