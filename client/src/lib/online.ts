import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Whether the browser has a network connection. TanStack Query pauses fetches and saves while it's false. */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
