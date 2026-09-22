import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export async function extractDocument(path: string): Promise<string | null> {
  const extension = extname(path).toLowerCase()
  if (['.txt', '.md', '.csv', '.json', '.yaml', '.yml'].includes(extension)) return readFile(path, 'utf8')
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
