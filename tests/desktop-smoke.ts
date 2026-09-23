import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const electron = process.env.SERENITY_SMOKE_EXECUTABLE ?? require('electron') as string
const packaged = Boolean(process.env.SERENITY_SMOKE_EXECUTABLE)
const workspace = await mkdtemp(join(tmpdir(), 'serenity-desktop-smoke-'))
await mkdir(join(workspace, 'documents'))
await mkdir(join(workspace, 'proposals'))
const proposalId = '123e4567-e89b-42d3-a456-426614174092'
await writeFile(join(workspace, 'proposals', `${proposalId}.yaml`), YAML.stringify({
  id: proposalId, kind: 'entity', title: 'Alex', type: 'person', body: 'Met at **robotics club**.',
  source: 'Smoke document', origin: 'ai-inference', provider: 'copilot',
  conversationId: '123e4567-e89b-42d3-a456-426614174093', status: 'pending', recordedAt: new Date().toISOString()
}))
const pdf = await PDFDocument.create()
pdf.addPage([400, 200]).drawText('QuarterlyCometResearch', { x: 25, y: 130, size: 16 })
await writeFile(join(workspace, 'documents', 'research.pdf'), await pdf.save())
const docx = new JSZip()
docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocxSyllabusDeadline</w:t></w:r></w:p></w:body></w:document>`)
await writeFile(join(workspace, 'documents', 'syllabus.docx'), await docx.generateAsync({ type: 'nodebuffer' }))
await writeFile(join(workspace, 'documents', 'unreadable.bin'), 'Not a supported document type')
const port = 20000 + Math.floor(Math.random() * 30000)
const child = spawn(electron, [`--remote-debugging-port=${port}`, ...(packaged ? [] : ['.']), `--workspace=${workspace}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
})
let output = ''
child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

async function evaluate(url: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error(`Renderer evaluation timed out for ${expression.slice(0, 85)}. App logs: ${output.slice(-1200)}`)) },
      process.env.SERENITY_SMOKE_PROVIDER ? 90000 : 30000)
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
      if (result.result?.exceptionDetails) reject(new Error(`${result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text}\nApp logs: ${output.slice(-3000)}`))
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
  const providers = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Connections')); if (button) { button.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const select = document.querySelector('#index-provider'); if (select) return [...select.options].map((option) => option.value); await new Promise((resolve) => setTimeout(resolve, 100)) } return [] })()`) as string[]
  assert.deepEqual(providers, ['copilot', 'codex'])
  await evaluate(pageUrl, `[...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Knowledge'))?.click()`)
  if (process.env.SERENITY_SMOKE_CREDENTIALS === '1') {
    const connected = await evaluate(pageUrl, `window.serenity.saveCredential('codex', 'test-session-only-key').then((status) => status.codex)`)
    assert.equal(connected, true)
    const disconnected = await evaluate(pageUrl, `window.serenity.saveCredential('codex', '').then((status) => status.codex)`)
    assert.equal(disconnected, false)
    await assert.rejects(readFile(join(workspace, 'provider-credentials.json'), 'utf8'), /ENOENT/)
  }
  const entityId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Alex', type: 'person', body: '# Alex\\nFrom **AI Club**.' }).then((snapshot) => snapshot.entities[0].id)`) as string
  assert.match(entityId, /^[a-f0-9-]{36}$/)
  assert.match(await readFile(join(workspace, 'entities', `${entityId}.md`), 'utf8'), /AI Club/)
  const preview = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.entity-link')].find((item) => item.textContent?.includes('Alex')); if (button) { button.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.markdown-preview strong')?.textContent ?? null } await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(preview, 'AI Club')
  const review = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Review')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.review-identity select')?.textContent ?? null })()`)
  assert.match(String(review), /Alex/)
  const attached = await evaluate(pageUrl, `window.serenity.attachEntityProposal('${proposalId}', '${entityId}').then((snapshot) => ({ entities: snapshot.entities.length, source: snapshot.claims.find((item) => item.key === 'context')?.source, target: snapshot.proposals.find((item) => item.id === '${proposalId}')?.resolvedInto }))`) as { entities: number; source: string; target: string }
  assert.deepEqual(attached, { entities: 1, source: 'Smoke document', target: entityId })
  const attachedContext = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Knowledge')); button?.click(); for (let i = 0; i < 30; i++) { const summary = document.querySelector('.claim-context summary'); if (summary) { summary.click(); return document.querySelector('.claim-context strong')?.textContent ?? null } await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(attachedContext, 'robotics club')
  const claimCount = await evaluate(pageUrl, `window.serenity.addClaim({ subject: '${entityId}', key: 'birthday', value: 'September 7', source: 'Alex' }).then((snapshot) => snapshot.claims.length)`)
  assert.equal(claimCount, 2)
  const results = await evaluate(pageUrl, `window.serenity.search('birthday').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(results.includes('claim'))
  const pdfResults = await evaluate(pageUrl, `window.serenity.search('QuarterlyCometResearch').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(pdfResults.includes('document'), 'PDF text should be searchable in the desktop app')
  const docxResults = await evaluate(pageUrl, `window.serenity.search('DocxSyllabusDeadline').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(docxResults.includes('document'), 'DOCX text should be searchable in the desktop app')
  const unsupported = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Documents')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const row = [...document.querySelectorAll('.document-row')].find((item) => item.textContent?.includes('unreadable.bin')); const actions = [...(row?.querySelectorAll('button') ?? [])].map((item) => item.textContent); return { label: row?.textContent, canAnalyze: actions.some((label) => label?.includes('Analyze')), canOpen: actions.some((label) => label?.includes('Open')) } })()`) as { label?: string; canAnalyze: boolean; canOpen: boolean }
  assert.match(unsupported.label ?? '', /No text extraction/)
  assert.equal(unsupported.canAnalyze, false)
  assert.equal(unsupported.canOpen, true)
  const invalidOpen = await evaluate(pageUrl, `window.serenity.openDocument('../outside').then(() => 'allowed', (error) => String(error))`) as string
  assert.match(invalidOpen, /Invalid document name/)
  const taskCount = await evaluate(pageUrl, `window.serenity.saveTask({ id: '', title: 'Call Alex', due: '2026-10-03', completed: false, notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.tasks.length)`)
  assert.equal(taskCount, 1)
  const eventCount = await evaluate(pageUrl, `window.serenity.saveEvent({ id: '', title: 'Meet Alex', start: '2026-10-04T10:00', notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.events.length)`)
  assert.equal(eventCount, 1)
  const archivedEventCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.archiveEvent(snapshot.events[0].id, snapshot.events[0].revision)).then((snapshot) => snapshot.archivedEvents.length)`)
  assert.equal(archivedEventCount, 1)
  const restoredEventCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.restoreEvent(snapshot.archivedEvents[0].id)).then((snapshot) => snapshot.events.length)`)
  assert.equal(restoredEventCount, 1)
  const archivedTaskCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.archiveTask(snapshot.tasks[0].id, snapshot.tasks[0].revision)).then((snapshot) => snapshot.archivedTasks.length)`)
  assert.equal(archivedTaskCount, 1)
  const restoredTaskCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.restoreTask(snapshot.archivedTasks[0].id)).then((snapshot) => snapshot.tasks.length)`)
  assert.equal(restoredTaskCount, 1)
  const calendarView = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Calendar')); if (button) { button.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.module-page h1')?.textContent ?? null } await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(calendarView, 'Calendar')
  const tasksView = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Tasks')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.module-page h1')?.textContent ?? null })()`)
  assert.equal(tasksView, 'Tasks')
  const disabled = await evaluate(pageUrl, `window.serenity.setModule('calendar', false).then((snapshot) => snapshot.modules.calendar)`)
  assert.equal(disabled, false)

  const provider = process.env.SERENITY_SMOKE_PROVIDER
  let privateId: string | undefined
  if (process.env.SERENITY_SMOKE_SCOPE === 'selected') {
    privateId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Private Project', type: 'project', body: 'SecretAstralToken' }).then((snapshot) => snapshot.entities.find((entity) => entity.title === 'Private Project').id)`) as string
  }
  if (provider === 'copilot' || provider === 'codex') {
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
    if (process.env.SERENITY_SMOKE_CANCEL === '1') {
      await evaluate(pageUrl, `window.__cancelledRun = window.serenity.sendMessage({ text: 'Write a thorough multi-page plan about the history of robotics and include many detailed examples.', provider: '${provider}', autonomy: 'propose', retained: true }).then(() => ({ status: 'completed' }), (error) => ({ status: 'cancelled', error: String(error) })); 'started'`)
      let cancelled = false
      for (let attempt = 0; attempt < 20; attempt++) {
        cancelled = await evaluate(pageUrl, 'window.serenity.cancelMessage()') as boolean
        if (cancelled) break
        await delay(50)
      }
      assert.equal(cancelled, true, 'The active request should be cancellable')
      const result = await evaluate(pageUrl, 'window.__cancelledRun') as { status: string; error?: string }
      assert.equal(result.status, 'cancelled', result.error)
      console.log(`${provider} request cancelled through Electron IPC.`)
    }
    if (process.env.SERENITY_SMOKE_EXTRACTION === '1') {
      await evaluate(pageUrl, `window.serenity.setModule('calendar', true)`)
      const extracted = await evaluate(pageUrl, `window.serenity.sendMessage({ text: 'Remember that Alex likes chess. Also make a task called Buy Alex a gift due 2026-10-03, and add an event called Lunch with Alex on 2026-10-04 at 12:00. Connect the task and event to Alex. Suggest each as a proposal with its source.', provider: '${provider}', autonomy: 'propose', retained: true }).then((snapshot) => snapshot.proposals.filter((item) => item.status === 'pending').map((item) => ({ kind: item.kind, source: item.source })))`) as { kind: string; source: string }[]
      assert.ok(extracted.some((item) => item.kind === 'claim'), `Expected a claim proposal: ${JSON.stringify(extracted)}`)
      assert.ok(extracted.some((item) => item.kind === 'task'), `Expected a task proposal: ${JSON.stringify(extracted)}`)
      assert.ok(extracted.some((item) => item.kind === 'event'), `Expected an event proposal: ${JSON.stringify(extracted)}`)
      console.log(`${provider} extracted claim, task, and event proposals from conversation.`)
    }
    if (process.env.SERENITY_SMOKE_SEMANTIC === '1') {
      const search = `window.serenity.semanticSearch('Find Alex birthday September 7', '${provider}').then((items) => items.map((item) => item.kind))`
      const small = await evaluate(pageUrl, search) as string[]
      assert.ok(small.includes('claim'), `Expected a sourced claim in semantic results: ${small}`)
      await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.saveEntity({ ...snapshot.entities.find((entity) => entity.id === '${entityId}'), body: 'Unrelated archive content. '.repeat(12000) }))`)
      const large = await evaluate(pageUrl, search) as string[]
      assert.ok(large.includes('claim'), `Expected relevant evidence in large-workspace results: ${large}`)
      console.log(`${provider} semantic retrieval worked with a large workspace.`)
    }
  }
  const duplicateId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Alex from club', type: 'person', body: 'Possible duplicate.' }).then((snapshot) => snapshot.entities.find((entity) => entity.title === 'Alex from club').id)`) as string
  const merged = await evaluate(pageUrl, `window.serenity.mergeEntities('${duplicateId}', '${entityId}').then((snapshot) => ({ active: snapshot.merges.length, archived: snapshot.archivedEntities.length }))`) as { active: number; archived: number }
  assert.equal(merged.active, 1)
  assert.equal(merged.archived, 1)
  const reversed = await evaluate(pageUrl, `window.serenity.unmergeEntities('${duplicateId}', 'Different Alex').then((snapshot) => ({ active: snapshot.merges.length, history: snapshot.mergeHistory.length, restored: snapshot.entities.some((entity) => entity.id === '${duplicateId}') }))`) as { active: number; history: number; restored: boolean }
  assert.deepEqual(reversed, { active: 0, history: 1, restored: true })
  console.log('Electron workspace, entity, claim, PDF/DOCX search, reversible merges/tasks/calendar, and preload IPC passed.')
} finally {
  child.kill()
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
