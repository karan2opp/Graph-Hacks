import { motion, useTransform } from 'motion/react'
import { along, type Pt, type Value } from './core'
import { Appear, Draw } from './shared'

/** From the machine's output tray to what it found: the person, and each statement. */
const OUTPUTS: { d: string; pts: Pt[] }[] = [
  { d: 'M380 994 V 1112', pts: [[380, 994], [380, 1112]] },
  { d: 'M372 994 C 372 1060, 275 1080, 275 1182', pts: cubic([372, 994], [372, 1060], [275, 1080], [275, 1182]) },
  { d: 'M388 994 C 388 1060, 485 1094, 485 1196', pts: cubic([388, 994], [388, 1060], [485, 1094], [485, 1196]) },
]

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt[] {
  return Array.from({ length: 17 }, (_, i) => {
    const u = i / 16
    const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]] as Pt
  })
}

/** Information flowing down an output line once it is drawn. */
function Flow({ t, on, pts, offset }: { t: Value; on: Value; pts: Pt[]; offset: number }) {
  const pos = useTransform(t, (v) => along(pts, (((v / 1.8 + offset) % 1) + 1) % 1))
  const x = useTransform(pos, (p) => p[0])
  const y = useTransform(pos, (p) => p[1])
  return <motion.circle cx="0" cy="0" r="3" fill="#D9B45A" style={{ x, y, opacity: on }} />
}

/** A statement pinned in the case file: date, what was said, and where. */
function NoteCard({ x, y, tilt, date, lines, cite }: { x: number; y: number; tilt: number; date: string; lines: string[]; cite: string }) {
  return (
    <>
      <g transform={`rotate(${tilt} ${x + 65} ${y + 56})`}>
        <rect x={x} y={y} width="130" height="112" rx="2" fill="#FFFFFF" stroke="#B5C3B0" strokeWidth="1" />
        <g fontFamily="Courier Prime, monospace" stroke="none">
          <text x={x + 12} y={y + 30} fontSize="12" fill="#55606C">{date}</text>
          {lines.map((line, i) => (
            <text key={line} x={x + 12} y={y + 54 + i * 18} fontSize="14.5" fill="#1B2430">{line}</text>
          ))}
          <text x={x + 12} y={y + 98} fontSize="11" fill="#55606C">{cite}</text>
        </g>
      </g>
      <circle cx={x + 65} cy={y + 7} r="5.5" fill="#A8231B" stroke="#6E140F" strokeWidth="1" />
    </>
  )
}

/** A label on the file: a person, or the subject both statements are about. */
function Tag(props: { x: number; y: number; width: number; height: number; rx: number; fill: string; color: string; children: string }) {
  const { x, y, width, height, rx, fill, color, children } = props
  return (
    <>
      <rect x={x} y={y} width={width} height={height} rx={rx} fill={fill} />
      <text x={x + width / 2} y={y + height / 2 + 5} textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif" fontSize="14" fontWeight="600" fill={color}>
        {children}
      </text>
    </>
  )
}

/** What the agents found, written into the case file: who said what, about what, and the contradiction. */
export function CaseFile({ t, c }: { t: Value; c: Value }) {
  const flowing = useTransform(c, [960, 990], [0, 1])
  const stamp = useTransform(c, [1130, 1150], [0, 1])
  const link = { c, stroke: '#55606C', strokeWidth: 1.5, span: 40 }

  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* The folder */}
      <path d="M200 1062 L 290 1062 C 296 1062, 300 1066, 302 1072 L 304 1078 L 200 1078 Z" fill="#CDB886" />
      <rect x="180" y="1076" width="400" height="344" rx="8" fill="#D8C496" stroke="#B9A372" strokeWidth="1.5" />
      <g transform="rotate(-1.2 380 1248)">
        <rect x="200" y="1094" width="360" height="308" fill="#FBFCF9" stroke="#C9D4C4" strokeWidth="1" />
        <path d={Array.from({ length: 10 }, (_, i) => `M214 ${1126 + i * 28} H 546`).join(' ')} stroke="#DCE4D8" strokeWidth="1" />
      </g>

      {OUTPUTS.map((o, i) => (
        <Draw key={i} c={c} at={900 + i * 12} d={o.d} stroke="#D9B45A" strokeWidth={1.8} />
      ))}
      {OUTPUTS.map((o, i) => (
        <Flow key={i} t={t} on={flowing} pts={o.pts} offset={i / 3} />
      ))}

      <Appear c={c} at={980}>
        <Tag x={305} y={1112} width={150} height={32} rx={16} fill="#5A3290" color="#FFFFFF">Suresh Gupta</Tag>
      </Appear>
      <Draw {...link} at={1010} d="M350 1144 L 275 1189" />
      <Draw {...link} at={1040} d="M410 1144 L 485 1203" />
      <Appear c={c} at={1010}>
        <NoteCard x={210} y={1182} tilt={-3} date="18.05.2021" lines={['Denies getting', 'Rs. 5,00,000']} cite="WS p1 para 1" />
      </Appear>
      <Appear c={c} at={1040}>
        <NoteCard x={420} y={1196} tilt={2.5} date="06.02.2023" lines={['Got it as a', 'friendly loan']} cite="Aff. DW1 para 1" />
      </Appear>
      <Draw {...link} at={1070} d="M280 1294 L 345 1352" />
      <Draw {...link} at={1080} d="M480 1308 L 415 1352" />
      <Appear c={c} at={1070}>
        <Tag x={310} y={1352} width={140} height={30} rx={3} fill="#C9A464" color="#2A1711">Rs. 5,00,000</Tag>
      </Appear>
      <Draw c={c} at={1100} span={40} d="M275 1189 C 330 1150, 430 1160, 485 1203" stroke="#A8231B" strokeWidth={2.8} />

      <motion.g style={{ opacity: stamp }} data-testid="flagged-stamp">
        <g transform="rotate(-9 486 1334)">
          <rect x="440" y="1321" width="92" height="26" rx="3" fill="none" stroke="#A8231B" strokeWidth="2.5" />
          <text x="486" y="1339" textAnchor="middle" fontFamily="Courier Prime, monospace" fontSize="13" fontWeight="700" letterSpacing="1.5" fill="#A8231B">
            FLAGGED
          </text>
        </g>
      </motion.g>
    </g>
  )
}
