import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

export type ThemePreference = 'system' | 'light' | 'dark'

function savedPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem('serenity.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch { return 'system' }
}

export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => {
      document.documentElement.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference
    }
    update()
    media.addEventListener('change', update)
    try { localStorage.setItem('serenity.theme', preference) } catch { /* Theme still works for this window. */ }
    return () => media.removeEventListener('change', update)
  }, [preference])
  return [preference, setPreference]
}

export function ThemeControl({ preference, onChange }: { preference: ThemePreference; onChange(theme: ThemePreference): void }) {
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor
  return <label className="theme-control"><Icon size={16}/><span>Appearance</span>
    <select aria-label="Appearance" value={preference} onChange={(event) => onChange(event.target.value as ThemePreference)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </label>
}
