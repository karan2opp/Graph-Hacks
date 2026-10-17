import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
// Trusted, hand-written markup ported from the Landing design (no user content goes in here).
import html from './landing/landing.html?raw'
import './landing/landing.css'

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** Where each part of the typewriter story appears, as a share of the scroll through the section. */
const NODES: Record<string, number> = { chip: 0.44, a: 0.5, b: 0.58, s: 0.64 }
const EDGES: Record<string, number> = { a: 0.52, b: 0.6, c: 0.66, d: 0.68, thread: 0.74 }

/** Paints one frame of the scroll story. Attributes are set directly: no React re-render per frame. */
function paint(root: HTMLElement, p: number) {
  const all = (sel: string) => root.querySelectorAll<SVGElement | HTMLElement>(sel)
  const set = (sel: string, attr: string, v: string | number) => all(sel).forEach((el) => el.setAttribute(attr, String(v)))

  const bar = root.querySelector<HTMLElement>('[data-anim="bar"]')
  if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`

  set('[data-anim="tape"]', 'stroke-dashoffset', 1 - ease(clamp((p - 0.02) / 0.4)))
  for (const [k, at] of Object.entries(NODES)) {
    const o = clamp((p - at) / 0.05)
    set(`[data-anim="node:${k}"]`, 'opacity', o)
    set(`[data-anim="node:${k}"]`, 'transform', `translate(0 ${(1 - o) * 10})`)
  }
  for (const [k, at] of Object.entries(EDGES)) set(`[data-anim="edge:${k}"]`, 'stroke-dashoffset', 1 - clamp((p - at) / 0.07))

  // The gavel appears raised, swings down onto the block from the handle end, and stays struck.
  const lift = clamp((p - 0.82) / 0.04)
  const strike = clamp((p - 0.88) / 0.04)
  const angle = p < 0.88 ? 38 * ease(lift) : 38 * (1 - strike * strike)
  set('[data-anim="gavel"]', 'opacity', clamp((p - 0.82) / 0.02))
  set('[data-anim="gavel-swing"]', 'transform', `rotate(${angle} 150 0)`)
  set('[data-anim="impact"]', 'opacity', p < 0.92 ? 0 : 1 - clamp((p - 0.92) / 0.06))
  set('[data-anim="stamp"]', 'opacity', clamp((p - 0.92) / 0.02))

  const active = p < 0.22 ? 0 : p < 0.44 ? 1 : p < 0.72 ? 2 : 3
  root.querySelectorAll<HTMLElement>('[data-step]').forEach((li) => {
    const i = Number(li.dataset.step)
    const dot = li.querySelector<HTMLElement>('[data-step-dot]')!
    li.style.color = i === active ? '#1B2430' : '#8A94A0'
    li.toggleAttribute('aria-current', i === active)
    dot.style.background = i === active ? '#1B2430' : i < active ? '#A8231B' : 'transparent'
    dot.style.color = i <= active ? '#FFFFFF' : '#8A94A0'
    dot.style.borderColor = i <= active ? 'transparent' : '#A9B4BE'
  })
}

export default function LandingPage() {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Case Memory: your case file, with a memory'
    const root = ref.current!
    const section = root.querySelector<HTMLElement>('#pipeline')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    const measure = () => {
      raf = 0
      const r = section.getBoundingClientRect()
      const total = r.height - window.innerHeight
      paint(root, reduced ? 1 : total > 0 ? clamp(-r.top / total) : 1)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    // Links to /app, /login etc. stay inside the single-page app.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      const href = a?.getAttribute('href')
      if (!a || !href?.startsWith('/') || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      navigate(href)
    }
    root.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      root.removeEventListener('click', onClick)
      if (raf) cancelAnimationFrame(raf)
      document.title = 'Case Memory'
    }
  }, [navigate])

  return <div className="landing" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}
