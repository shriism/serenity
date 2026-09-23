import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const electron = process.env.SERENITY_SMOKE_EXECUTABLE ?? require('electron') as string
const packaged = Boolean(process.env.SERENITY_SMOKE_EXECUTABLE)
const workspace = await mkdtemp(join(tmpdir(), 'serenity-desktop-smoke-'))
await mkdir(join(workspace, 'documents'))
const pdf = await PDFDocument.create()
pdf.addPage([400, 200]).drawText('QuarterlyCometResearch', { x: 25, y: 130, size: 16 })
await writeFile(join(workspace, 'documents', 'research.pdf'), await pdf.save())
const docx = new JSZip()
docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocxSyllabusDeadline</w:t></w:r></w:p></w:body></w:document>`)
await writeFile(join(workspace, 'documents', 'syllabus.docx'), await docx.generateAsync({ type: 'nodebuffer' }))
const port = 20000 + Math.floor(Math.random() * 30000)
const child = spawn(electron, [`--remote-debugging-port=${port}`, ...(packaged ? [] : ['.']), `--workspace=${workspace}`], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

async function evaluate(url: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Renderer evaluation timed out')) }, 30000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true
    } })))
    socket.addEventListener('message', (event) => {
      const result = JSON.parse(String(event.data)) as {
        id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }
      }
      if (result.id !== 1) return
      clearTimeout(timeout)
      socket.close()
      if (result.result?.exceptionDetails) reject(new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text))
      else resolve(result.result?.result?.value)
    })
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to the renderer')) })
  })
}

try {
  let pageUrl = ''
  let observed: unknown = null
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited before opening a window.\n${output}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]
      const page = pages.find((item) => item.type === 'page')
      if (page) {
        const result = await evaluate(page.webSocketDebuggerUrl, '({ bridge: typeof window.serenity?.refresh, title: document.title })') as { bridge: string; title: string }
        observed = result
        if (result.bridge === 'function' && result.title === 'Serenity') { pageUrl = page.webSocketDebuggerUrl; break }
      }
    } catch { /* Renderer may still be loading. */ }
    await delay(200)
  }
  assert.ok(pageUrl, `Desktop window or preload bridge did not start. Observed ${JSON.stringify(observed)}\n${output}`)

  const path = await evaluate(pageUrl, 'window.serenity.refresh().then((snapshot) => snapshot?.path)')
  assert.equal(path, workspace)
  const entityId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Alex', type: 'person', body: 'From AI Club.' }).then((snapshot) => snapshot.entities[0].id)`) as string
  assert.match(entityId, /^[a-f0-9-]{36}$/)
  assert.match(await readFile(join(workspace, 'entities', `${entityId}.md`), 'utf8'), /From AI Club/)
  const claimCount = await evaluate(pageUrl, `window.serenity.addClaim({ subject: '${entityId}', key: 'birthday', value: 'September 7', source: 'Alex' }).then((snapshot) => snapshot.claims.length)`)
  assert.equal(claimCount, 1)
  const results = await evaluate(pageUrl, `window.serenity.search('birthday').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(results.includes('claim'))
  const pdfResults = await evaluate(pageUrl, `window.serenity.search('QuarterlyCometResearch').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(pdfResults.includes('document'), 'PDF text should be searchable in the desktop app')
  const docxResults = await evaluate(pageUrl, `window.serenity.search('DocxSyllabusDeadline').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(docxResults.includes('document'), 'DOCX text should be searchable in the desktop app')
  const taskCount = await evaluate(pageUrl, `window.serenity.saveTask({ id: '', title: 'Call Alex', due: '2026-10-03', completed: false, notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.tasks.length)`)
  assert.equal(taskCount, 1)
  const eventCount = await evaluate(pageUrl, `window.serenity.saveEvent({ id: '', title: 'Meet Alex', start: '2026-10-04T10:00', notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.events.length)`)
  assert.equal(eventCount, 1)
  const disabled = await evaluate(pageUrl, `window.serenity.setModule('calendar', false).then((snapshot) => snapshot.modules.calendar)`)
  assert.equal(disabled, false)

  const provider = process.env.SERENITY_SMOKE_PROVIDER
  let privateId: string | undefined
  if (process.env.SERENITY_SMOKE_SCOPE === 'selected') {
    privateId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Private Project', type: 'project', body: 'SecretAstralToken' }).then((snapshot) => snapshot.entities.find((entity) => entity.title === 'Private Project').id)`) as string
  }
  if (provider === 'copilot' || provider === 'codex' || provider === 'claude') {
    const scope = privateId ? `, readScope: { mode: 'selected', entityIds: ['${entityId}'], documentNames: [], includeOtherConversations: false, includeCalendarAndTasks: false }` : ''
    const answer = await evaluate(pageUrl, `window.serenity.sendMessage({ text: 'According to the sourced claim about Alex, what is his birthday? Include the date. Do not propose any changes.', provider: '${provider}', autonomy: 'propose', retained: true${scope} }).then((snapshot) => ({ id: snapshot.conversations[0].id, text: snapshot.conversations[0].messages.at(-1)?.text, shared: snapshot.conversations[0].messages[0].sharedContext?.length, sharedRecords: snapshot.conversations[0].messages[0].sharedContext?.flatMap((entry) => entry.records.map((record) => record.ref)), readScope: snapshot.conversations[0].readScope, permissions: snapshot.conversations[0].permissions, activity: snapshot.providerActivity.find((entry) => entry.provider === '${provider}') }))`) as { id: string; text: string; shared: number; sharedRecords: string[]; readScope: { mode: string }; permissions: { claims: boolean; tasks: boolean }; activity: { status: string; operation: string; refs: string[] } }
    assert.match(answer.text, /September 7/i)
    assert.ok(answer.shared > 0)
    assert.equal(answer.activity?.status, 'completed')
    assert.equal(answer.activity?.operation, 'conversation')
    assert.ok(answer.activity?.refs.some((ref) => ref.startsWith('claim:')))
    assert.equal(answer.permissions?.claims, true)
    assert.equal(answer.permissions?.tasks, false)
    if (privateId) {
      assert.equal(answer.readScope.mode, 'selected')
      assert.equal(answer.sharedRecords.includes(`entity:${privateId}`), false)
      assert.equal(answer.sharedRecords.some((ref) => ref.startsWith('document:')), false)
      assert.equal(answer.activity.refs.includes(`entity:${privateId}`), false)
    }
    const settings = await evaluate(pageUrl, `window.serenity.updateConversationSettings('${answer.id}', { autonomy: 'autonomous', permissions: { claims: true, entities: false, tasks: true, events: false }, retained: true }).then((snapshot) => snapshot.conversations[0])`) as { autonomy: string; permissions: { tasks: boolean } }
    assert.equal(settings.autonomy, 'autonomous')
    assert.equal(settings.permissions.tasks, true)
    console.log(`${provider} conversation completed through Electron IPC.`)
  }
  console.log('Electron workspace, entity, claim, PDF/DOCX search, task, calendar, and preload IPC passed.')
} finally {
  child.kill()
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
