import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export const plainTextExtensions = ['.txt', '.md', '.csv', '.json', '.yaml', '.yml']

/** Extracts a document's text in the calling thread. PDF and DOCX parsing is CPU-heavy; see `extractDocument`. */
export async function extractDocumentHere(path: string): Promise<string | null> {
  const extension = extname(path).toLowerCase()
  if (plainTextExtensions.includes(extension)) return readFile(path, 'utf8')
  if (extension === '.docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ path })).value
  }
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) })
    try { return (await parser.getText()).text }
    finally { await parser.destroy() }
  }
  return null
}
