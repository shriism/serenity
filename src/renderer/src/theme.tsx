import { useEffect, useState } from 'react'

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
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    try { localStorage.setItem('serenity.theme', preference) } catch { /* Theme still works for this window. */ }
  }, [preference, resolved])
  return [preference, setPreference, resolved]
}
