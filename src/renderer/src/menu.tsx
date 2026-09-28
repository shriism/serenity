import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  /** Right-aligned hint, such as a shortcut. */
  detail?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  /** Draws a separator above this item. */
  separated?: boolean
  run(): void
}

/**
 * A button that opens a small native-style menu. Arrow keys move through items, Enter chooses, and Escape or a click
 * elsewhere closes it and returns focus to the button.
 */
export function MenuButton({ label, children, items, className = 'icon-btn', align = 'start', title, header }: {
  label: string
  children: ReactNode
  items: MenuItem[]
  className?: string
  align?: 'start' | 'end'
  title?: string
  /** Optional text shown above the items, e.g. a full path. */
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top?: number; left?: number; right?: number; bottom?: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const up = below < 240 && rect.top > below
    const horizontal = align === 'end' ? { right: window.innerWidth - rect.right } : { left: rect.left }
    setPosition(up ? { bottom: window.innerHeight - rect.top + 4, ...horizontal } : { top: rect.bottom + 4, ...horizontal })
  }, [open, align])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus())
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur) }
  }, [open])

  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    const entries = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])
    const index = entries.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); entries[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); entries.at(-1)?.focus() }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <>
    <button ref={button} type="button" className={`${className} ${open ? 'pressed' : ''}`} aria-label={label} title={title ?? label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>{children}</button>
    {open && position && <div ref={menu} id={id} className="menu" role="menu" aria-label={label} style={position} onKeyDown={keys}>
      {header && <div className="menu-header">{header}</div>}
      {items.map((item) => <div key={item.id} className="menu-entry">
        {item.separated && <div className="menu-separator" role="separator"/>}
        <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked}
          className={`menu-item ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
          onClick={() => { setOpen(false); button.current?.focus(); item.run() }}>
          <span className="menu-icon" aria-hidden="true">{item.checked ? '✓' : item.icon}</span>
          <span className="menu-label">{item.label}</span>
          {item.detail && <span className="menu-detail">{item.detail}</span>}
        </button>
      </div>)}
    </div>}
  </>
}
