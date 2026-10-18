import { motion, useTransform } from 'motion/react'
import { BAR, HAND, KEY, carriageShift, struck, type Value } from './core'
import { Pivot } from './shared'

const SKIN = '#F2D3BD'
const TOP = '#222B3A'
const SLEEVE_FAR = '#303A4C'
const TROUSERS = '#EFE6D2'
const HAIR = '#2B2220'
const WOOD = '#7A4E36'
const WOOD_DARK = '#5A3726'
const METAL = '#232B36'

/** Where the typebars strike: the ink ribbon, just under the platen. The paper starts above it. */
const PRINT_POINT = { x: 382, y: 242 }
/** The type guide the bars come up to, and the half-moon opening they rest in. */
const GUIDE = { x: 382, y: 252 }
const SEGMENT = { cx: 382, cy: 268, rx: 34, ry: 10 }

/** Key rows step up the sloped front of the body, five keys a row. */
const keyAt = (row: number, col: number) => ({ x: 268 + 10 * row + 11 * col, y: 285 - 8 * row })
const ROWS = [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3, 4].map((col) => keyAt(row, col)))
/** The keys the hands play (KEY 0-3): two under the near hand, two under the far hand. */
const PLAYED = [keyAt(0, 2), keyAt(1, 1), keyAt(2, 2), keyAt(3, 1)]
const isPlayed = (k: { x: number; y: number }) => PLAYED.some((p) => p.x === k.x && p.y === k.y)

/** A point on the lower rim of the opening, `deg` degrees round from the right. */
const rim = (deg: number) => {
  const a = (deg * Math.PI) / 180
  return { x: SEGMENT.cx + SEGMENT.rx * Math.cos(a), y: SEGMENT.cy + SEGMENT.ry * Math.sin(a) }
}
const REST_SHARE = 0.4 // resting bars lie back toward the typist, so from the front they look short
/** The resting fan of typebars, from the rim toward the type guide. */
const FAN = [20, 40, 60, 80, 100, 120, 140, 160]
  .map((d) => {
    const r = rim(d)
    const x = r.x + (GUIDE.x - r.x) * REST_SHARE, y = r.y + (GUIDE.y - r.y) * REST_SHARE
    return `M${r.x.toFixed(1)} ${r.y.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`
  })
  .join(' ')

/** The four bars that strike. At rest each lies in the fan; struck, it rises to the ribbon at full length. */
const angle = (dx: number, dy: number) => (Math.atan2(dy, dx) * 180) / Math.PI
const BARS = [40, 80, 100, 140].map((d) => {
  const pivot = rim(d)
  const length = Math.hypot(PRINT_POINT.x - pivot.x, PRINT_POINT.y - pivot.y)
  return {
    ...pivot,
    length,
    rest: angle(GUIDE.x - pivot.x, GUIDE.y - pivot.y),
    hit: angle(PRINT_POINT.x - pivot.x, PRINT_POINT.y - pivot.y),
    restReach: (REST_SHARE * Math.hypot(GUIDE.x - pivot.x, GUIDE.y - pivot.y)) / length,
  }
})

const useCarriage = (t: Value) => useTransform(t, carriageShift)

/** A round key on its stem. */
function KeyCap({ x, y }: { x: number; y: number }) {
  return (
    <>
      <path d={`M${x} ${y + 2} V ${y + 5.5}`} stroke="#0E131A" strokeWidth="2" />
      <circle cx={x} cy={y} r="3.7" fill="#EFE6D2" stroke="#0E131A" strokeWidth="1.3" />
    </>
  )
}

function PlayedKey({ t, index }: { t: Value; index: number }) {
  const y = useTransform(t, (v) => 1.8 * struck(v, KEY, index))
  return (
    <motion.g style={{ y }}>
      <KeyCap {...PLAYED[index]} />
    </motion.g>
  )
}

function Typebar({ t, index }: { t: Value; index: number }) {
  const { x, y, rest, hit, length, restReach } = BARS[index]
  const swing = useTransform(t, (v) => struck(v, BAR, index))
  const rotate = useTransform(swing, (k) => rest + (hit - rest) * k)
  const reach = useTransform(swing, (k) => restReach + (1 - restReach) * k)
  return (
    <Pivot x={x} y={y} rotate={rotate}>
      <motion.g style={{ scaleX: reach, transformBox: 'view-box', originX: '0px', originY: '0px' }}>
        <line x1="0" y1="0" x2={length - 3} y2="0" stroke="#AEB8C2" strokeWidth="1.6" />
        <rect x={length - 4.5} y="-2" width="4.5" height="4" rx="1" fill="#D5DCE2" />
      </motion.g>
    </Pivot>
  )
}

/** A forearm and hand, pivoting at the elbow; the hand dips as its keys go down. */
function Forearm({ t, hand, elbow, wrist, sleeve }: { t: Value; hand: number; elbow: [number, number]; wrist: [number, number]; sleeve: string }) {
  const rotate = useTransform(t, (v) => 3.2 * struck(v, HAND, hand) - 0.6)
  const [wx, wy] = [wrist[0] - elbow[0], wrist[1] - elbow[1]]
  return (
    <Pivot x={elbow[0]} y={elbow[1]} rotate={rotate}>
      <path d={`M0 0 L ${wx} ${wy}`} stroke={sleeve} strokeWidth="14" strokeLinecap="round" />
      <path
        transform={`translate(${wx + 3} ${wy})`}
        d="M-2 -5 C 6 -6, 13 -4, 17 0 C 19 3, 17 6, 13 5 C 9 7, 3 6, -2 5 Z"
        fill={SKIN}
        stroke="#C99C82"
        strokeWidth="1"
      />
    </Pivot>
  )
}

/** Everything behind the paper: room, stenographer, desk, typewriter body and keys. */
export function TypingBack({ t }: { t: Value }) {
  const shift = useCarriage(t)
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <line x1="40" y1="430" x2="484" y2="430" stroke="#AEBDA9" strokeWidth="2" />

      {/* Chair */}
      <path d="M128 232 C 120 278, 122 320, 132 356" fill="none" stroke={WOOD} strokeWidth="8" />
      <path d="M124 234 C 132 226, 144 228, 148 238" fill="none" stroke={WOOD} strokeWidth="7" />
      <path d="M134 360 L 126 430 M206 360 L 214 430 M131 400 L 210 400" fill="none" stroke={WOOD} strokeWidth="6" />

      {/* Far arm's shoulder, behind the body */}
      <path d="M182 252 C 192 270, 198 286, 204 300" fill="none" stroke={SLEEVE_FAR} strokeWidth="17" />

      {/* Legs and shoes */}
      <path d="M150 334 C 180 328, 228 329, 252 333 C 266 336, 266 356, 252 358 L 158 361 C 140 361, 138 336, 150 334 Z" fill={TROUSERS} stroke="#D2C4A6" strokeWidth="1.2" />
      <path d="M240 344 L 264 344 L 268 420 L 246 420 Z" fill={TROUSERS} stroke="#D2C4A6" strokeWidth="1.2" />
      <path d="M244 418 C 248 412, 270 412, 280 418 C 288 423, 284 431, 274 431 L 246 431 C 240 431, 240 422, 244 418 Z" fill="#1B2430" />
      <path d="M247 428 H 279" stroke="#F4F1E8" strokeWidth="2" />
      <rect x="122" y="350" width="92" height="10" rx="3" fill={WOOD} />

      {/* Body, neck and head */}
      <path d="M150 352 C 139 320, 137 280, 148 254 C 156 238, 184 234, 198 246 C 208 260, 208 300, 200 336 L 194 354 Z" fill={TOP} />
      <path d="M181 224 L 182 244 L 196 244 L 194 222 Z" fill={SKIN} />
      <path
        d="M178 186 C 188 178, 205 180, 209 194 C 212 200, 216 206, 215 209 C 214 211, 211 212, 210 213 C 212 216, 211 219, 208 220 C 209 224, 207 228, 201 229 C 193 231, 184 228, 178 220 Z"
        fill={SKIN}
      />
      {/* Long hair, falling down her back */}
      <path
        d="M208 190 C 204 176, 186 170, 171 177 C 155 184, 149 204, 145 222 C 141 240, 128 252, 126 273 C 124 293, 135 305, 127 323 C 122 334, 128 344, 141 341 C 153 338, 150 322, 154 306 C 158 290, 152 276, 160 262 C 168 250, 176 242, 182 230 C 188 218, 184 206, 191 198 C 196 193, 202 192, 208 190 Z"
        fill={HAIR}
      />
      <circle cx="204" cy="202" r="6" fill="none" stroke="#1B2430" strokeWidth="1.8" />
      <path d="M198 202 L 189 204" stroke="#1B2430" strokeWidth="1.6" />

      {/* Desk */}
      <rect x="226" y="300" width="254" height="12" rx="2" fill={WOOD} />
      <rect x="232" y="312" width="242" height="6" fill={WOOD_DARK} />
      <path d="M300 318 L 296 430 M458 318 L 462 430" fill="none" stroke="#6B4330" strokeWidth="8" />

      {/* Typewriter: the carriage bed, then the body with brass trim */}
      <rect x="300" y="228" width="156" height="30" rx="4" fill="#161B23" />
      <rect x="250" y="290" width="212" height="10" rx="3" fill="#141A22" />
      <path d="M256 290 L 300 254 L 446 254 C 453 254, 458 259, 458 266 L 458 290 Z" fill={METAL} />
      <path d="M302 255 H 445" stroke="#3E4A58" strokeWidth="2" />
      <path d="M262 288 H 456" stroke="#C9A464" strokeWidth="1.5" />
      <rect x="426" y="271" width="22" height="7" rx="1.5" fill="#C9A464" />

      {/* Half-moon opening with the resting typebars, the type guide, spools and ink ribbon */}
      <ellipse {...SEGMENT} fill="#0E1218" stroke="#3A4554" strokeWidth="1.2" />
      <path d={FAN} stroke="#8E9AA6" strokeWidth="1.4" />
      <rect x={GUIDE.x - 5} y={GUIDE.y - 6} width="10" height="7" rx="1.5" fill="#9AA6B2" />
      <ellipse cx="328" cy="251" rx="10" ry="4" fill="#3A4554" stroke="#10151C" strokeWidth="1.2" />
      <ellipse cx="436" cy="251" rx="10" ry="4" fill="#3A4554" stroke="#10151C" strokeWidth="1.2" />
      <path d="M330 248 L 366 241.5 H 398 L 434 248" fill="none" stroke="#2A2324" strokeWidth="4.5" strokeLinecap="butt" />
      <path d="M331 249.6 L 366 243.2 H 398 L 433 249.6" fill="none" stroke="#A8231B" strokeWidth="1.6" strokeLinecap="butt" />

      {/* Keyboard */}
      <rect x="270" y="289" width="58" height="3.5" rx="1.75" fill="#EFE6D2" stroke="#0E131A" strokeWidth="1" />
      {ROWS.filter((k) => !isPlayed(k)).map((k) => (
        <KeyCap key={`${k.x}-${k.y}`} {...k} />
      ))}
      {PLAYED.map((_, i) => (
        <PlayedKey key={i} t={t} index={i} />
      ))}

      {/* The plate behind the paper rides with the carriage */}
      <motion.rect x="334" y="192" width="96" height="26" rx="3" fill="#2C3542" style={{ x: shift }} />
    </g>
  )
}

/** Everything in front of the paper: platen and carriage, typebars, and the stenographer's hands. */
export function TypingFront({ t }: { t: Value }) {
  const shift = useCarriage(t)
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <motion.g style={{ x: shift }}>
        <rect x="322" y="214" width="120" height="22" rx="11" fill="#1B2430" />
        <path d="M332 219 H 432" stroke="#46525F" strokeWidth="2" />
        <path d="M330 209 H 434" stroke="#9AA6B2" strokeWidth="1.5" />
        <circle cx="366" cy="209" r="2.6" fill="#C3CBD4" />
        <circle cx="398" cy="209" r="2.6" fill="#C3CBD4" />
        <circle cx="316" cy="225" r="9" fill="#2C3542" stroke="#10151C" strokeWidth="1.2" />
        <circle cx="448" cy="225" r="10" fill="#C9A464" />
        <circle cx="448" cy="225" r="4" fill="#8A6A33" />
        <path d="M313 217 C 303 202, 291 196, 278 198" fill="none" stroke="#C9A464" strokeWidth="3.5" />
        <circle cx="276" cy="198" r="4.2" fill="#C9A464" />
      </motion.g>

      {[0, 1, 2, 3].map((i) => (
        <Typebar key={i} t={t} index={i} />
      ))}

      <Forearm t={t} hand={1} elbow={[204, 300]} wrist={[294, 272]} sleeve={SLEEVE_FAR} />
      <path d="M190 256 C 198 274, 204 290, 212 306" fill="none" stroke={TOP} strokeWidth="18" />
      <Forearm t={t} hand={0} elbow={[212, 306]} wrist={[276, 282]} sleeve={TOP} />
    </g>
  )
}
