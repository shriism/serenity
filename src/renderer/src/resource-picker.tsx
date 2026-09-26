import { useMemo, useState } from 'react'

export interface PickerOption { id: string; title: string; detail?: string }

const normalized = (text: string): string => text.normalize('NFKD').toLocaleLowerCase().trim()
/** Small lists are offered in full; larger ones by search, so the picker stays usable with thousands of options. */
const browseLimit = 12

/** Chosen items as removable chips, with a search (or, for short lists, the full list) to add more. */
export function ResourcePicker({ label, placeholder, options, selected, onChange, empty }: {
  label: string
  placeholder: string
  options: PickerOption[]
  selected: string[]
  onChange(ids: string[]): void
  /** Shown when there is nothing to choose from. */
  empty: string
}) {
  const [query, setQuery] = useState('')
  const chosen = useMemo(() => selected.flatMap((id) => options.find((option) => option.id === id) ?? []), [options, selected])
  const matches = useMemo(() => {
    const wanted = normalized(query)
    const available = options.filter((option) => !selected.includes(option.id))
    if (!wanted) return available.length <= browseLimit ? available : []
    return available.filter((option) => normalized(`${option.title} ${option.detail ?? ''}`).includes(wanted))
      .sort((a, b) => Number(!normalized(a.title).startsWith(wanted)) - Number(!normalized(b.title).startsWith(wanted)) || a.title.localeCompare(b.title)).slice(0, 8)
  }, [options, selected, query])
  if (!options.length) return <small className="hint">{empty}</small>
  return <div className="resource-picker">
    {chosen.length > 0 && <div className="module-link-chips">{chosen.map((option) => <span key={option.id} className="module-link-chip">{option.title}
      <button type="button" aria-label={`Remove ${option.title}`} title={`Remove ${option.title}`} onClick={() => onChange(selected.filter((id) => id !== option.id))}>×</button></span>)}</div>}
    {options.length > browseLimit && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={label}/>}
    {matches.length > 0 && <div className="module-link-matches" role="group" aria-label={label}>{matches.map((option) => <button type="button" key={option.id}
      onClick={() => { onChange([...selected, option.id]); setQuery('') }}>{option.title} {option.detail && <small>{option.detail}</small>}</button>)}</div>}
  </div>
}
