import { useEffect, useLayoutEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

function savedPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem('serenity.theme')
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark'
  } catch { return 'dark' }
}

/** The appearance preference, a setter, and the theme actually shown once "system" is resolved. */
export function useTheme(): [ThemePreference, (theme: ThemePreference) => void, 'dark' | 'light'] {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const resolved = preference === 'system' ? systemDark ? 'dark' : 'light' : preference
  useLayoutEffect(() => {
    const root = document.documentElement
    // Theme colors must change together: interpolating text over an already changed
    // background briefly makes light and dark themes unreadable.
    root.classList.add('changing-theme')
    root.dataset.theme = resolved
    void root.offsetWidth
    root.classList.remove('changing-theme')
    try { localStorage.setItem('serenity.theme', preference) } catch { /* Theme still works for this window. */ }
  }, [preference, resolved])
  return [preference, setPreference, resolved]
}
