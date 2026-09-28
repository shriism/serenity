import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { extractDocumentHere, plainTextExtensions } from './document-text'

export function canExtractText(path: string): boolean {
  return [...plainTextExtensions, '.docx', '.pdf'].includes(extname(path).toLowerCase())
}

// Parsing a large PDF can take seconds of CPU; doing it on the main process would stall every other request, so it
// runs in a worker. If the worker cannot start (as when running from source in tests), parsing falls back to here.
const workerFile = fileURLToPath(new URL('./extract-worker.js', import.meta.url))
const timeoutMs = 60000
let worker: Worker | null = null
let workerFailed = !existsSync(workerFile)
let nextId = 0
const pending = new Map<number, { resolve(text: string | null): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()

function failAll(error: Error): void {
  for (const [id, request] of pending) { clearTimeout(request.timer); request.reject(error); pending.delete(id) }
}

function extractionWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(workerFile)
    worker.unref()
    worker.on('message', ({ id, text, error }: { id: number; text?: string | null; error?: string }) => {
      const request = pending.get(id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(id)
      if (error) request.reject(new Error(error))
      else request.resolve(text ?? null)
    })
    worker.on('error', (error) => { console.error('Document text worker failed:', error); failAll(error); worker = null })
    worker.on('exit', () => { failAll(new Error('Document text worker stopped')); worker = null })
  } catch (error) {
    console.error('Document text worker could not start; extracting in the main process:', error)
    workerFailed = true
    worker = null
  }
  return worker
}

export async function extractDocument(path: string): Promise<string | null> {
  const extension = extname(path).toLowerCase()
  if (plainTextExtensions.includes(extension)) return extractDocumentHere(path)
  if (extension !== '.pdf' && extension !== '.docx') return null
  const thread = extractionWorker()
  if (!thread) return extractDocumentHere(path)
  const id = ++nextId
  return new Promise<string | null>((resolve, reject) => {
    // A document that never finishes parsing restarts the worker rather than holding every later request.
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Reading ${path} took longer than ${timeoutMs / 1000} seconds`))
      void thread.terminate()
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    thread.postMessage({ id, path })
  })
}
