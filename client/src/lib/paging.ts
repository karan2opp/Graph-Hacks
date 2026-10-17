import { useRef } from 'react'
import { useSearchParams } from 'react-router'

/**
 * One page of a list. The page number lives in the URL (?page=2), so back, forward, refresh and
 * shared links keep it; a page past the end (after a filter shrinks the list) falls back to the last.
 * ponytail: pages a list the API returns whole; move to server-side limit/offset if a case grows to thousands of items.
 */
export function usePaged<T>(items: T[], size = 10, param = 'page') {
  const [params, setParams] = useSearchParams()
  const listRef = useRef<HTMLElement | null>(null)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get(param))) || 1))

  const setPage = (p: number) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (p <= 1) next.delete(param)
      else next.set(param, String(p))
      return next
    })
    // Bring the top of the list back into view when the reader has scrolled past it.
    const top = listRef.current?.getBoundingClientRect().top
    if (top !== undefined && top < 0) listRef.current!.scrollIntoView({ block: 'start' })
  }
  /** Back to page 1 when a search or filter changes, without adding a history entry for each keystroke. */
  const reset = () => {
    if (!params.has(param)) return
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(param)
        return next
      },
      { replace: true },
    )
  }

  return { page, pages, size, total: items.length, items: items.slice((page - 1) * size, page * size), setPage, reset, listRef }
}
export type Paged = Omit<ReturnType<typeof usePaged>, 'items' | 'listRef' | 'reset'>

/** Page numbers to show: first, last, and the current one with its neighbours; gaps become null. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const sorted = [...keep].sort((a, b) => a - b)
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1]! > 1 ? [null, n] : [n]))
}
