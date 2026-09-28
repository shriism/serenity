import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'

test('text documents are created, edited with revision checks, and other formats are not', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-document-edit-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const first = await workspace.createDocument()
    assert.equal(first.name, 'Untitled.md')
    assert.equal((await workspace.createDocument()).name, 'Untitled 2.md', 'a second new document gets its own name')
    const { text, revision } = await workspace.readEditableDocument('Untitled.md')
    assert.equal(text, '')
    const saved = await workspace.saveDocumentText('Untitled.md', '# Plan\n\nFirst draft', revision)
    assert.equal(await readFile(join(directory, 'documents', 'Untitled.md'), 'utf8'), '# Plan\n\nFirst draft')
    await assert.rejects(workspace.saveDocumentText('Untitled.md', 'stale', revision), /changed on disk/)
    await workspace.saveDocumentText('Untitled.md', '# Plan\n\nSecond draft', saved.revision)
    await writeFile(join(directory, 'documents', 'scan.pdf'), 'not really a pdf')
    workspace.markDirty()
    await assert.rejects(workspace.readEditableDocument('scan.pdf'), /Only Markdown and plain-text/)
    await assert.rejects(workspace.saveDocumentText('../escape.md', 'x', revision), /Invalid document name/)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
