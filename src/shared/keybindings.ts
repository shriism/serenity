// Keybindings are written as `Mod+Shift+K`. `Mod` is Command on macOS and Control elsewhere; `Ctrl` is the
// Control key on macOS. Normalized bindings list modifiers in a fixed order so equal chords compare equal.

const modifierOrder = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const
const namedKeys = ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`)]

export function normalizeKeybinding(value: string): string | null {
  const parts = value.split('+').map((part) => part.trim())
  const key = parts.pop()
  if (!key || parts.length > modifierOrder.length || parts.some((part) => !part)) return null
  const modifiers = new Set<string>()
  for (const part of parts) {
    const modifier = modifierOrder.find((item) => item.toLowerCase() === part.toLowerCase())
    if (!modifier || modifiers.has(modifier)) return null
    modifiers.add(modifier)
  }
  const named = namedKeys.find((item) => item.toLowerCase() === key.toLowerCase())
  const normalizedKey = named ?? ([...key].length === 1 && key !== ' ' ? key.toUpperCase() : null)
  if (!normalizedKey) return null
  // A chord without Mod, Ctrl, or Alt would steal ordinary typing, so only function keys may stand alone or with Shift.
  if (!modifiers.has('Mod') && !modifiers.has('Ctrl') && !modifiers.has('Alt') && !/^F\d+$/.test(normalizedKey)) return null
  return [...modifierOrder.filter((item) => modifiers.has(item)), normalizedKey].join('+')
}

export interface KeyEventLike { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

export function eventKeybinding(event: KeyEventLike, mac: boolean): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null
  // Physical letter and digit codes keep Shift- and Option-modified chords stable across layouts' shifted characters.
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) :
    event.key === ' ' ? 'Space' : [...event.key].length === 1 ? event.key.toUpperCase() : event.key
  const modifiers = [(mac ? event.metaKey : event.ctrlKey) && 'Mod', mac && event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift']
  return [...modifiers.filter(Boolean), key].join('+')
}

export function formatKeybinding(binding: string, mac: boolean): string {
  const parts = binding.split('+')
  const key = parts.pop()!
  if (!mac) return [...parts.map((part) => part === 'Mod' ? 'Ctrl' : part), key].join('+')
  const symbols: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
  return `${parts.map((part) => symbols[part]).join('')}${key}`
}

export interface KeymapResult { bindings: Map<string, string>; byCommand: Map<string, string>; problems: string[] }

/**
 * Combines built-in default bindings with a workspace keymap. A workspace entry replaces its command's default and may
 * take a chord from another command's default; `null` removes a binding. Two workspace entries for one chord conflict,
 * and the earlier entry keeps it.
 */
export function resolveKeymap(defaults: readonly { id: string; keybinding?: string }[], overrides: Readonly<Record<string, string | null>> = {},
  known: ReadonlySet<string> = new Set(defaults.map((item) => item.id))): KeymapResult {
  const byCommand = new Map<string, string>()
  const problems: string[] = []
  for (const item of defaults) if (item.keybinding) byCommand.set(item.id, item.keybinding)
  const claimed = new Map<string, string>()
  for (const [id, value] of Object.entries(overrides)) {
    if (!known.has(id)) { problems.push(`Keybinding for unknown command ${id}`); continue }
    if (value === null) { byCommand.delete(id); continue }
    const binding = normalizeKeybinding(value)
    if (!binding) { problems.push(`Invalid keybinding for ${id}: ${value}`); continue }
    const holder = claimed.get(binding)
    if (holder) { problems.push(`${binding} is bound to both ${holder} and ${id}; ${holder} keeps it`); continue }
    claimed.set(binding, id)
    byCommand.set(id, binding)
  }
  for (const [id, binding] of byCommand) if (claimed.has(binding) && claimed.get(binding) !== id) byCommand.delete(id)
  const bindings = new Map<string, string>()
  for (const [id, binding] of byCommand) {
    const holder = bindings.get(binding)
    if (holder) { problems.push(`${binding} is bound to both ${holder} and ${id}; ${holder} keeps it`); byCommand.delete(id) }
    else bindings.set(binding, id)
  }
  return { bindings, byCommand, problems }
}
