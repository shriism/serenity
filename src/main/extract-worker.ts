import { parentPort } from 'node:worker_threads'
import { extractDocumentHere } from './document-text'

// Parses PDF and DOCX files off the main process's event loop, one request at a time.
parentPort?.on('message', async ({ id, path }: { id: number; path: string }) => {
  try { parentPort?.postMessage({ id, text: await extractDocumentHere(path) }) }
  catch (error) { parentPort?.postMessage({ id, error: String(error) }) }
})
