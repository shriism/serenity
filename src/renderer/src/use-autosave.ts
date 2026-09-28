import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceSnapshot } from '../../shared/types'

// Editors across the window share one unsaved-work signal, so closing the window can ask before discarding anything.
let unsaved = 0
function reportUnsaved(change: number): void {
  unsaved = Math.max(0, unsaved + change)
  window.serenity.setEditorDirty(unsaved > 0)
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'conflict' | 'error'

/**
 * Saves an editor's text shortly after typing pauses, when it loses focus, and when it closes, the way native note
 * apps do. Each save carries the revision the text was based on; if the file changed on disk in the meantime, the
 * save is refused and the editor offers a choice instead of overwriting either version.
 */
export function useAutosave<T>({ saved, revision, save, revisionOf, onUpdate, onError, delay = 700 }: {
  /** The content as stored on disk, from the latest snapshot. */
  saved: T
  /** Revision of the stored content, from the latest snapshot. */
  revision: string | undefined
  /** Writes `draft` over `base`; returns the new snapshot. */
  save(draft: T, base: string | undefined): Promise<WorkspaceSnapshot>
  /** The stored revision in a snapshot a save returned, so typing during the save does not look like a conflict. */
  revisionOf(snapshot: WorkspaceSnapshot): string | undefined
  onUpdate(snapshot: WorkspaceSnapshot): void
  onError(message: string): void
  delay?: number
}) {
  const [draft, setDraftState] = useState<T>(saved)
  const [state, setState] = useState<SaveState>('saved')
  const current = useRef({ draft: saved, base: revision, dirty: false, saving: false, conflict: false })
  const timer = useRef<number | null>(null)
  const counted = useRef(false)
  const io = useRef({ save, revisionOf, onUpdate, onError })
  io.current = { save, revisionOf, onUpdate, onError }

  const count = (dirty: boolean): void => { if (dirty !== counted.current) { counted.current = dirty; reportUnsaved(dirty ? 1 : -1) } }

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
    const edit = current.current
    if (!edit.dirty || edit.saving || edit.conflict) return
    edit.saving = true
    edit.dirty = false
    const sent = edit.draft
    setState('saving')
    try {
      const snapshot = await io.current.save(sent, edit.base)
      edit.base = io.current.revisionOf(snapshot)
      edit.saving = false
      io.current.onUpdate(snapshot)
      // Typing that happened during the save is saved next.
      setState(edit.dirty ? 'pending' : 'saved')
      if (edit.dirty) timer.current = window.setTimeout(() => void flush(), delay)
      else count(false)
    } catch (error) {
      edit.saving = false
      edit.dirty = true
      const conflict = /changed on disk|removed on disk/i.test(String(error))
      edit.conflict = conflict
      setState(conflict ? 'conflict' : 'error')
      if (!conflict) io.current.onError(String(error))
    }
  }, [delay])

  // Adopt the stored version when it changes and there is nothing unsaved here; a newer revision after our own save
  // only moves the base forward.
  useEffect(() => {
    const edit = current.current
    if (edit.saving) return
    if (!edit.dirty) {
      edit.base = revision
      edit.draft = saved
      setDraftState(saved)
      return
    }
    if (revision !== edit.base && !edit.conflict) { edit.conflict = true; setState('conflict') }
  }, [saved, revision])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    const edit = current.current
    // Closing a tab saves what was typed; a refused save is reported rather than silently lost.
    if (edit.dirty && !edit.saving && !edit.conflict) void io.current.save(edit.draft, edit.base).then(io.current.onUpdate, (error) => io.current.onError(`Your last edits were not saved: ${String(error)}`))
    else if (edit.conflict) io.current.onError('A closed editor had edits that conflicted with a change on disk; they were not saved.')
    count(false)
  }, [])

  const setDraft = useCallback((next: T): void => {
    const edit = current.current
    edit.draft = next
    edit.dirty = true
    setDraftState(next)
    count(true)
    if (edit.conflict) return
    setState((value) => value === 'saving' ? value : 'pending')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), delay)
  }, [delay, flush])

  /** Resolves a conflict: keep this editor's text over the disk version, or take the disk version. */
  const resolve = useCallback((keepMine: boolean): void => {
    const edit = current.current
    edit.conflict = false
    edit.base = revision
    if (keepMine) { edit.dirty = true; void flush() }
    else { edit.dirty = false; edit.draft = saved; setDraftState(saved); setState('saved'); count(false) }
  }, [revision, saved, flush])

  return { draft, setDraft, state, flush, resolve }
}
