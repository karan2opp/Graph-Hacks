import { motion, useTransform } from 'motion/react'
import { VIEW_H, VIEW_W, carriageShift, clamp, linesFed, typedShare, type Pt, type Value } from './core'

/**
 * The paper's centre line as cubic segments: up out of the platen, over in a curl, then down in a
 * long S into the machine's slot. Ends are vertical so it sits squarely in both.
 */
const CURVE: [Pt, Pt, Pt, Pt][] = [
  [[382, 230], [382, 202], [382, 182], [384, 162]],
  [[384, 162], [387, 108], [488, 98], [500, 158]],
  [[500, 158], [508, 200], [513, 250], [512, 300]],
  [[512, 300], [512, 420], [312, 452], [302, 560]],
  [[302, 560], [294, 660], [380, 720], [380, 798]],
]

const WIDTH = 58
const SAMPLES = 260
const LINE_GAP = 15 // between typed lines, along the paper
const FIRST_LINE = 16 // the line being typed, just above the platen
const LINE_MAX = 40
const WAVE = 7 // how far the paper sways, in SVG units

/** The centre line sampled at even distances: positions, normals and how upright it is. */
const BASE = (() => {
  const raw: Pt[] = []
  for (const [p0, p1, p2, p3] of CURVE) {
    for (let i = 0; i < 60; i++) {
      const u = i / 60
      const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3
      raw.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
    }
  }
  raw.push(CURVE[CURVE.length - 1][3])
  const dist = [0]
  for (let i = 1; i < raw.length; i++) dist.push(dist[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]))
  const length = dist[dist.length - 1]

  const x: number[] = [], y: number[] = [], nx: number[] = [], ny: number[] = [], upright: number[] = []
  let j = 0
  for (let i = 0; i < SAMPLES; i++) {
    const target = (i / (SAMPLES - 1)) * length
    while (j < dist.length - 2 && dist[j + 1] < target) j++
    const f = (target - dist[j]) / (dist[j + 1] - dist[j] || 1)
    x.push(raw[j][0] + f * (raw[j + 1][0] - raw[j][0]))
    y.push(raw[j][1] + f * (raw[j + 1][1] - raw[j][1]))
  }
  for (let i = 0; i < SAMPLES; i++) {
    const a = Math.max(0, i - 1), b = Math.min(SAMPLES - 1, i + 1)
    const tx = x[b] - x[a], ty = y[b] - y[a], n = Math.hypot(tx, ty) || 1
    nx.push(-ty / n)
    ny.push(tx / n)
    upright.push(Math.abs(ty / n))
  }
  return { x, y, nx, ny, upright, length }
})()

/** A fixed pseudo-random number per line, so each line keeps its length as it travels. */
const noise = (k: number, salt: number) => {
  const v = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** The paper at time t, showing the first `reveal` share of it. Everything is built from the same points. */
function paperAt(t: number, reveal: number) {
  const shift = carriageShift(t)
  const point = (s: number, offset = 0): Pt => {
    const f = s * (SAMPLES - 1)
    const i = Math.min(SAMPLES - 2, Math.floor(f))
    const k = f - i
    const lerp = (arr: number[]) => arr[i] + k * (arr[i + 1] - arr[i])
    // A wave travels down the paper; it fades to nothing at both ends so the paper stays attached.
    const sway = WAVE * Math.sin(Math.PI * s) * Math.sin(2 * Math.PI * (2.2 * s - t / 3)) + offset
    const attach = shift * Math.max(0, 1 - s / 0.12)
    return [lerp(BASE.x) + lerp(BASE.nx) * sway + attach, lerp(BASE.y) + lerp(BASE.ny) * sway]
  }

  const steps = Math.max(2, Math.ceil(reveal * (SAMPLES - 1)))
  const edge: string[] = []
  for (let i = 0; i <= steps; i++) {
    const [px, py] = point((i / steps) * reveal)
    edge.push(`${px.toFixed(1)} ${py.toFixed(1)}`)
  }
  const paper = `M${edge.join('L')}`

  // Lines of type, written across the paper and kept level. Each moves along with the paper.
  const fed = linesFed(t)
  const current = -Math.floor(fed + 1e-6)
  const shown = reveal * BASE.length - 10
  let text = ''
  for (let k = current; ; k++) {
    const along = FIRST_LINE + (k + fed) * LINE_GAP
    if (along > shown) break
    if (along < FIRST_LINE - 0.5) continue
    const s = along / BASE.length
    const level = clamp((BASE.upright[Math.round(s * (SAMPLES - 1))] - 0.35) / 0.25) // none where the paper runs flat
    // Every seventh line ends a paragraph (short) and the next one is indented.
    const full = k % 7 === 6 ? 10 + noise(k, 1) * 8 : 22 + noise(k, 2) * (LINE_MAX - 22)
    const width = full * level * (k === current ? typedShare(t) : 1)
    if (width < 2) continue
    const [px, py] = point(s)
    const left = px - LINE_MAX / 2 + (k % 7 === 0 ? 5 : 0)
    text += `M${left.toFixed(1)} ${py.toFixed(1)}h${width.toFixed(1)}`
  }

  // A few gold flecks drifting down beside the paper, the way the content travels.
  let flecks = ''
  for (let i = 0; i < 3; i++) {
    const s = ((t / 16 + i / 3) % 1) * reveal
    if (s < 0.3) continue
    const [px, py] = point(s, (i % 2 ? 1 : -1) * (WIDTH / 2 + 14))
    flecks += `M${(px - 2).toFixed(1)} ${py.toFixed(1)}a2 2 0 1 0 4 0a2 2 0 1 0 -4 0`
  }
  return { paper, text: text || 'M0 0', flecks: flecks || 'M0 0' }
}

/** A scrap of paper floating by, bobbing and turning slowly. */
function Scrap({ t, x, y, phase }: { t: Value; x: number; y: number; phase: number }) {
  const dy = useTransform(t, (v) => 6 * Math.sin(v * 1.1 + phase))
  const rotate = useTransform(t, (v) => 10 * Math.sin(v * 0.7 + phase))
  return (
    <motion.g style={{ y: dy, rotate }}>
      <path d={`M${x} ${y} l18 -4 l3 13 l-17 5 Z`} fill="#FBF7EC" stroke="#C9C1AE" strokeWidth="1" />
      <path d={`M${x + 4} ${y + 3} l10 -2.2 M${x + 5} ${y + 8} l7 -1.5`} stroke="#A8AFB8" strokeWidth="1.2" strokeLinecap="round" />
    </motion.g>
  )
}

/** The transcript: a strip of typed paper running from the typewriter into the machine. */
export function PaperRibbon({ t, c }: { t: Value; c: Value }) {
  // Reveal follows the reader down the page; the first part is out of the typewriter from the start.
  const reveal = useTransform(c, [320, 760], [0.3, 1])
  const shape = useTransform([t, reveal], ([tv, rv]: number[]) => paperAt(tv, rv))
  const paper = useTransform(shape, (s) => s.paper)
  const text = useTransform(shape, (s) => s.text)
  const flecks = useTransform(shape, (s) => s.flecks)

  return (
    <g>
      <mask id="paperText" maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW_W} height={VIEW_H}>
        <motion.path d={paper} fill="none" stroke="#FFFFFF" strokeWidth={WIDTH - 8} strokeLinejoin="round" />
      </mask>
      <motion.path d={paper} fill="none" stroke="#1B2430" strokeWidth={WIDTH + 4} strokeLinejoin="round" />
      <motion.path d={paper} fill="none" stroke="#FBF7EC" strokeWidth={WIDTH} strokeLinejoin="round" />
      <g mask="url(#paperText)">
        <motion.path d={text} fill="none" stroke="#7D8794" strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <motion.path d={flecks} fill="#D9B45A" />
      <Scrap t={t} x={556} y={420} phase={0} />
      <Scrap t={t} x={196} y={540} phase={2.1} />
    </g>
  )
}
