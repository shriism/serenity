import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const electron = process.env.SERENITY_SMOKE_EXECUTABLE ?? require('electron') as string
const packaged = Boolean(process.env.SERENITY_SMOKE_EXECUTABLE)
if (packaged) {
  const resources = process.platform === 'darwin' ? join(dirname(electron), '..', 'Resources') : join(dirname(electron), 'resources')
  const platform = `${process.platform}-${process.arch}`
  const copilot = join(resources, 'app.asar.unpacked', 'node_modules', `@github/copilot-sdk-${platform}`,
    'prebuilds', platform, process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime')
  const triples: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl', 'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc', 'win32-x64': 'x86_64-pc-windows-msvc'
  }
  const codex = join(resources, 'app.asar.unpacked', 'node_modules', `@openai/codex-${platform}`,
    'vendor', triples[platform], 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
  assert.ok((await stat(copilot)).isFile(), 'The packaged Copilot runtime must be available')
  assert.ok((await stat(codex)).isFile(), 'The packaged Codex runtime must be available')
}
const workspace = await mkdtemp(join(tmpdir(), 'serenity-desktop-smoke-'))
const futureDate = (days: number): string => {
  const day = new Date()
  day.setDate(day.getDate() + days)
  return day.toLocaleDateString('en-CA')
}
const taskDue = futureDate(7)
const eventDate = futureDate(8)
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

async function captureScreenshot(url: string): Promise<Buffer> {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('UI screenshot timed out')) }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } })))
    socket.addEventListener('message', (event) => {
      const result = JSON.parse(String(event.data)) as { id?: number; result?: { data?: string } }
      if (result.id !== 2) return
      clearTimeout(timeout)
      socket.close()
      result.result?.data ? resolve(Buffer.from(result.result.data, 'base64')) : reject(new Error('Screenshot contained no image data'))
    })
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not capture the desktop UI')) })
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
  const home = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const heading = document.querySelector('.home-page h1'); if (heading) return heading.textContent; await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`) as string | null
  assert.match(home ?? '', /^Good /)
  const paneControls = await evaluate(pageUrl, `(async () => { const shell = document.querySelector('.serenity-studio'); const initial = Boolean(shell && document.querySelector('.assistant-sidebar') && document.querySelector('#workspace-main')); document.querySelector('[aria-label="Collapse navigation"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 400)); const logo = document.querySelector('.brand-icon')?.getBoundingClientRect().left; const icon = document.querySelector('.navigation button svg')?.getBoundingClientRect().left; const main = document.querySelector('#workspace-main')?.getBoundingClientRect().left; const left = shell?.classList.contains('left-collapsed') && Boolean(document.querySelector('[aria-label="Expand navigation"]')); document.querySelector('[aria-label="Expand navigation"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 400)); const stable = logo === document.querySelector('.brand-icon')?.getBoundingClientRect().left && icon === document.querySelector('.navigation button svg')?.getBoundingClientRect().left && main === document.querySelector('#workspace-main')?.getBoundingClientRect().left; document.querySelector('[aria-label="Collapse AI sidebar"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 50)); const right = shell?.classList.contains('right-collapsed') && Boolean(document.querySelector('.assistant-rail button')); document.querySelector('.assistant-rail button')?.click(); await new Promise((resolve) => setTimeout(resolve, 50)); document.querySelector('[aria-label="Expand AI over workspace"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 50)); const expanded = shell?.classList.contains('ai-expanded') && getComputedStyle(document.querySelector('#workspace-main')).display === 'none'; document.querySelector('[aria-label="Return AI to sidebar"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 50)); return { initial, left, stable, right, expanded, restored: Boolean(document.querySelector('.assistant-sidebar')) && !shell?.classList.contains('ai-expanded') } })()`)
  assert.deepEqual(paneControls, { initial: true, left: true, stable: true, right: true, expanded: true, restored: true }, 'The dock must not shift its logo, icons, or canvas when it reveals labels')
  const collapsedAssistant = await evaluate(pageUrl, `(async () => { document.querySelector('[aria-label="Collapse AI sidebar"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 60)); const icon = document.querySelector('.assistant-rail button svg')?.getAttribute('class') ?? ''; const menu = document.querySelector('.topbar-more summary')?.getBoundingClientRect().right ?? 0; const edge = document.querySelector('#workspace-main')?.getBoundingClientRect().right ?? 0; document.querySelector('.assistant-rail button')?.click(); await new Promise((resolve) => setTimeout(resolve, 60)); return { icon, menuAtRight: edge - menu < 75 } })()`) as { icon: string; menuAtRight: boolean }
  assert.match(collapsedAssistant.icon, /lucide-panel-right-open/, 'The collapsed AI rail should show the expand-panel symbol')
  assert.equal(collapsedAssistant.menuAtRight, true, 'Workspace actions should stay at the far right even with the AI pane closed')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-dock-expanded.png'), await captureScreenshot(pageUrl))
  await evaluate(pageUrl, `(async () => { document.querySelector('[aria-label="Collapse navigation"]')?.click(); await new Promise((resolve) => setTimeout(resolve, 410)) })()`)
  const railShortcuts = await evaluate(pageUrl, `(async () => { const mod = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'; const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, [mod]: true, bubbles: true })); press('b'); await new Promise((resolve) => setTimeout(resolve, 60)); const nav = document.querySelector('.serenity-studio')?.classList.contains('dock-open'); press('b'); await new Promise((resolve) => setTimeout(resolve, 60)); press('j'); await new Promise((resolve) => setTimeout(resolve, 60)); const assistant = document.querySelector('.serenity-studio')?.classList.contains('right-collapsed'); press('j'); await new Promise((resolve) => setTimeout(resolve, 60)); return { nav, assistant, restored: Boolean(document.querySelector('.assistant-sidebar')) && Boolean(document.querySelector('.left-collapsed')) } })()`)
  assert.deepEqual(railShortcuts, { nav: true, assistant: true, restored: true }, 'Keyboard shortcuts should toggle each panel without affecting open files')
  const secondaryControls = await evaluate(pageUrl, `(() => { document.querySelector('.topbar-more summary')?.click(); document.querySelector('.compose-options summary')?.click(); document.querySelector('.conversation-workflow summary')?.click(); const result = { newEntity: [...document.querySelectorAll('.topbar-menu button')].some((item) => item.textContent?.includes('New entity')), refresh: [...document.querySelectorAll('.topbar-menu button')].some((item) => item.textContent?.includes('Refresh files')), providers: document.querySelector('.compose-options select')?.options.length, readScope: Boolean(document.querySelector('.conversation-workflow select')) }; document.querySelector('.topbar-more summary')?.click(); document.querySelector('.compose-options summary')?.click(); document.querySelector('.conversation-workflow summary')?.click(); return result })()`)
  assert.deepEqual(secondaryControls, { newEntity: true, refresh: true, providers: 2, readScope: true }, 'Advanced actions should remain available through quiet disclosures')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-home.png'), await captureScreenshot(pageUrl))
  const theme = await evaluate(pageUrl, `(async () => { const select = document.querySelector('.theme-control select'); select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); const changed = document.documentElement.dataset.theme; select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); return changed })()`) as string
  assert.equal(theme, 'dark')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) {
    await evaluate(pageUrl, `(async () => { const select = document.querySelector('.theme-control select'); select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 120)) })()`)
    await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-home-light.png'), await captureScreenshot(pageUrl))
    await evaluate(pageUrl, `(async () => { const select = document.querySelector('.theme-control select'); select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 120)) })()`)
  }
  const spotlight = await evaluate(pageUrl, `(async () => { const trigger = document.querySelector('.topbar-search'); trigger.click(); for (let i = 0; i < 30 && !document.querySelector('.command-palette'); i++) await new Promise((resolve) => setTimeout(resolve, 100)); await new Promise((resolve) => setTimeout(resolve, 240)); const rect = document.querySelector('.command-palette')?.getBoundingClientRect(); return { compact: trigger.getBoundingClientRect().width <= 44, centered: Boolean(rect && Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 20 && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 20), opened: Boolean(rect) } })()`) as { compact: boolean; centered: boolean; opened: boolean }
  assert.equal(spotlight.compact && spotlight.centered && spotlight.opened, true, `The magnifying glass should open a centered Spotlight-style search palette: ${JSON.stringify(spotlight)}`)
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-search.png'), await captureScreenshot(pageUrl))
  await evaluate(pageUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  const providers = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Settings')); if (button) { button.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const select = document.querySelector('#index-provider'); if (select) return [...select.options].map((option) => option.value); await new Promise((resolve) => setTimeout(resolve, 100)) } return [] })()`) as string[]
  assert.deepEqual(providers, ['copilot', 'codex'])
  const displayedPath = await evaluate(pageUrl, `document.querySelector('.settings-workspace strong')?.textContent`)
  assert.equal(displayedPath, workspace)
  const settingsError = await evaluate(pageUrl, `(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); return document.querySelector('.notice.error')?.textContent ?? null })()`)
  assert.equal(settingsError, null, `Settings should load credentials without an error: ${settingsError}`)
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-settings.png'), await captureScreenshot(pageUrl))
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
  const preview = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.entity-link, .knowledge-tiles button')].find((item) => item.textContent?.includes('Alex')); if (button) { button.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.markdown-preview strong')?.textContent ?? null } await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(preview, 'AI Club')
  const activeEntityTab = await evaluate(pageUrl, `document.querySelector('.workspace-tab.active')?.textContent ?? null`)
  assert.match(String(activeEntityTab), /Alex/, 'Opened entities should remain available as workspace tabs')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-knowledge.png'), await captureScreenshot(pageUrl))
  const review = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Review')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.review-identity select')?.textContent ?? null })()`)
  assert.match(String(review), /Alex/)
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-review.png'), await captureScreenshot(pageUrl))
  const attached = await evaluate(pageUrl, `window.serenity.attachEntityProposal('${proposalId}', '${entityId}').then((snapshot) => ({ entities: snapshot.entities.length, source: snapshot.claims.find((item) => item.key === 'context')?.source, target: snapshot.proposals.find((item) => item.id === '${proposalId}')?.resolvedInto }))`) as { entities: number; source: string; target: string }
  assert.deepEqual(attached, { entities: 1, source: 'Smoke document', target: entityId })
  const attachedContext = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Knowledge')); button?.click(); for (let i = 0; i < 40; i++) { const rich = document.querySelector('.claim-context strong'); if (rich) { document.querySelector('.claim-context summary')?.click(); return { text: rich.textContent, view: 'knowledge' } } await new Promise((resolve) => setTimeout(resolve, 100)) } return { text: null, view: document.querySelector('.main')?.textContent?.slice(0, 200) } })()`) as { text: string | null; view: string }
  assert.equal(attachedContext.text, 'robotics club', attachedContext.view)
  const claimCount = await evaluate(pageUrl, `window.serenity.addClaim({ subject: '${entityId}', key: 'birthday', value: 'September 7', source: 'Alex' }).then((snapshot) => snapshot.claims.length)`)
  assert.equal(claimCount, 2)
  const homeContext = await evaluate(pageUrl, `(async () => { [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Home'))?.click(); for (let i = 0; i < 30; i++) { const focus = document.querySelector('.home-focus-title')?.textContent; const recent = document.querySelector('.home-recent-list')?.textContent; if (focus?.includes('Alex') && recent?.includes('birthday')) return true; await new Promise((resolve) => setTimeout(resolve, 100)) } return false })()`)
  assert.equal(homeContext, true, 'Home should surface an existing person and real recent changes without inventing AI observations')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-home-with-data.png'), await captureScreenshot(pageUrl))
  const results = await evaluate(pageUrl, `window.serenity.search('birthday').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(results.includes('claim'))
  const paletteResults = await evaluate(pageUrl, `(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true, bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 80)); const input = document.querySelector('.palette-input input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'birthday'); input.dispatchEvent(new Event('input', { bubbles: true })); for (let i = 0; i < 30; i++) { const match = [...document.querySelectorAll('.palette-results button')].find((item) => item.textContent?.includes('birthday')); if (match) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true } await new Promise((resolve) => setTimeout(resolve, 100)) } window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false })()`) as boolean
  assert.equal(paletteResults, true, 'The command palette should search workspace claims')
  const openedClaim = await evaluate(pageUrl, `(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Home'))?.click(); await new Promise((resolve) => setTimeout(resolve, 150)); document.querySelector('.topbar-search')?.click(); for (let i = 0; i < 30; i++) { const input = document.querySelector('.palette-input input'); if (input) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'birthday'); input.dispatchEvent(new Event('input', { bubbles: true })); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const match = [...document.querySelectorAll('.palette-results button')].find((item) => item.textContent?.includes('birthday')); if (match) { match.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const title = document.querySelector('.editor #title')?.value; if (title === 'Alex') return title; await new Promise((resolve) => setTimeout(resolve, 100)) } return { view: document.querySelector('.main')?.textContent?.slice(0, 150), palette: Boolean(document.querySelector('.command-palette')) } })()`)
  assert.equal(openedClaim, 'Alex', 'Selecting a claim search result should open its entity')
  const pdfResults = await evaluate(pageUrl, `window.serenity.search('QuarterlyCometResearch').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(pdfResults.includes('document'), 'PDF text should be searchable in the desktop app')
  const docxResults = await evaluate(pageUrl, `window.serenity.search('DocxSyllabusDeadline').then((items) => items.map((item) => item.kind))`) as string[]
  assert.ok(docxResults.includes('document'), 'DOCX text should be searchable in the desktop app')
  const unsupported = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Documents')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const row = [...document.querySelectorAll('.document-row')].find((item) => item.textContent?.includes('unreadable.bin')); const actions = [...(row?.querySelectorAll('button') ?? [])].map((item) => item.textContent); return { label: row?.textContent, canAnalyze: actions.some((label) => label?.includes('Analyze')), canOpen: actions.some((label) => label?.includes('Open')) } })()`) as { label?: string; canAnalyze: boolean; canOpen: boolean }
  assert.match(unsupported.label ?? '', /No text extraction/)
  assert.equal(unsupported.canAnalyze, false)
  assert.equal(unsupported.canOpen, true)
  const documentText = await evaluate(pageUrl, `window.serenity.readDocument('research.pdf').then((text) => text?.includes('QuarterlyCometResearch'))`)
  assert.equal(documentText, true, 'Extractable documents should be readable inside the workspace')
  const documentTab = await evaluate(pageUrl, `(async () => { [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Documents'))?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); [...document.querySelectorAll('.document-row')].find((item) => item.textContent?.includes('research.pdf'))?.querySelector('button')?.click(); for (let i = 0; i < 30; i++) { if (document.querySelector('.document-text')?.textContent?.includes('QuarterlyCometResearch')) return document.querySelector('.workspace-tab.active')?.textContent; await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.match(String(documentTab), /research.pdf/, 'Reading a document should open a contextual tab')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-documents.png'), await captureScreenshot(pageUrl))
  const invalidOpen = await evaluate(pageUrl, `window.serenity.openDocument('../outside').then(() => 'allowed', (error) => String(error))`) as string
  assert.match(invalidOpen, /Invalid document name/)
  const taskCount = await evaluate(pageUrl, `window.serenity.saveTask({ id: '', title: 'Call Alex', due: '${taskDue}', completed: false, notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.tasks.length)`)
  assert.equal(taskCount, 1)
  const eventCount = await evaluate(pageUrl, `window.serenity.saveEvent({ id: '', title: 'Meet Alex', start: '${eventDate}T10:00', notes: '', relatedEntityIds: ['${entityId}'] }).then((snapshot) => snapshot.events.length)`)
  assert.equal(eventCount, 1)
  const archivedEventCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.archiveEvent(snapshot.events[0].id, snapshot.events[0].revision)).then((snapshot) => snapshot.archivedEvents.length)`)
  assert.equal(archivedEventCount, 1)
  const restoredEventCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.restoreEvent(snapshot.archivedEvents[0].id)).then((snapshot) => snapshot.events.length)`)
  assert.equal(restoredEventCount, 1)
  const archivedTaskCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.archiveTask(snapshot.tasks[0].id, snapshot.tasks[0].revision)).then((snapshot) => snapshot.archivedTasks.length)`)
  assert.equal(archivedTaskCount, 1)
  const restoredTaskCount = await evaluate(pageUrl, `window.serenity.refresh().then((snapshot) => window.serenity.restoreTask(snapshot.archivedTasks[0].id)).then((snapshot) => snapshot.tasks.length)`)
  assert.equal(restoredTaskCount, 1)
  const focusedEvent = await evaluate(pageUrl, `(async () => { [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Home'))?.click(); for (let i = 0; i < 30; i++) { const item = [...document.querySelectorAll('.home-list button')].find((button) => button.textContent?.includes('Meet Alex')); if (item) { item.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const selected = document.querySelector('.module-aside .module-form input')?.value; if (selected === 'Meet Alex') return selected; await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(focusedEvent, 'Meet Alex', 'Home should open the selected event on its calendar date')
  const focusedTask = await evaluate(pageUrl, `(async () => { [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Home'))?.click(); for (let i = 0; i < 30; i++) { const item = [...document.querySelectorAll('.home-list button')].find((button) => button.textContent?.includes('Call Alex')); if (item) { item.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const selected = document.querySelector('.module-aside .module-form input')?.value; if (selected === 'Call Alex') return selected; await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(focusedTask, 'Call Alex', 'Home should open the selected task')
  const calendarView = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Calendar')); if (button) { button.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.module-page h1')?.textContent ?? null } await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
  assert.equal(calendarView, 'Calendar')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-calendar.png'), await captureScreenshot(pageUrl))
  const tasksView = await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Tasks')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return document.querySelector('.module-page h1')?.textContent ?? null })()`)
  assert.equal(tasksView, 'Tasks')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-tasks.png'), await captureScreenshot(pageUrl))
  const chatView = await evaluate(pageUrl, `Boolean(document.querySelector('.assistant-sidebar .conversation-panel'))`)
  assert.equal(chatView, true)
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-conversation.png'), await captureScreenshot(pageUrl))
  const disabled = await evaluate(pageUrl, `window.serenity.setModule('calendar', false).then((snapshot) => snapshot.modules.calendar)`)
  assert.equal(disabled, false)

  const provider = process.env.SERENITY_SMOKE_PROVIDER
  let privateId: string | undefined
  if (process.env.SERENITY_SMOKE_SCOPE === 'selected') {
    privateId = await evaluate(pageUrl, `window.serenity.saveEntity({ id: '', title: 'Private Project', type: 'project', body: 'SecretAstralToken' }).then((snapshot) => snapshot.entities.find((entity) => entity.title === 'Private Project').id)`) as string
  }
  if (provider === 'copilot' || provider === 'codex') {
    const activeContext = await evaluate(pageUrl, `(async () => { document.querySelector('.workspace-tab-label')?.click(); for (let i = 0; i < 30; i++) { const file = document.querySelector('.ai-context-strip'); if (file?.textContent?.includes('Alex') && file?.title?.includes('entities/')) return file.title; await new Promise((resolve) => setTimeout(resolve, 100)) } return null })()`)
    assert.match(String(activeContext), /entities\//, 'The assistant should show the currently open file before sending')
    const scope = privateId ? `, readScope: { mode: 'selected', entityIds: ['${entityId}'], documentNames: [], includeOtherConversations: false, includeCalendarAndTasks: false }` : ''
    const answer = await evaluate(pageUrl, `window.serenity.sendMessage({ text: 'According to the sourced claim about Alex, what is his birthday? Include the date. Do not propose any changes.', provider: '${provider}', autonomy: 'propose', retained: true${scope} }).then((snapshot) => ({ id: snapshot.conversations[0].id, text: snapshot.conversations[0].messages.at(-1)?.text, shared: snapshot.conversations[0].messages[0].sharedContext?.length, sharedRecords: snapshot.conversations[0].messages[0].sharedContext?.flatMap((entry) => entry.records.map((record) => record.ref)), readScope: snapshot.conversations[0].readScope, permissions: snapshot.conversations[0].permissions, activity: snapshot.providerActivity.find((entry) => entry.provider === '${provider}') }))`) as { id: string; text: string; shared: number; sharedRecords: string[]; readScope: { mode: string }; permissions: { claims: boolean; tasks: boolean }; activity: { status: string; operation: string; refs: string[] } }
    assert.match(answer.text, /September 7/i)
    assert.ok(answer.shared > 0)
    assert.ok(answer.sharedRecords.includes(`entity:${entityId}`), 'The open entity should be available in the context sent to AI')
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
    if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) {
      const shown = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 30; i++) { const button = document.querySelector('.conversation-history-list button'); if (button) { button.click(); break } await new Promise((resolve) => setTimeout(resolve, 100)) } for (let i = 0; i < 30; i++) { const count = document.querySelectorAll('.message').length; if (count >= 2) return count; await new Promise((resolve) => setTimeout(resolve, 100)) } return document.querySelectorAll('.message').length })()`)
      assert.ok(Number(shown) >= 2)
      await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-conversation-reply.png'), await captureScreenshot(pageUrl))
    }
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
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) {
    await evaluate(pageUrl, `(async () => { const button = [...document.querySelectorAll('.navigation button')].find((item) => item.textContent?.includes('Activity')); button?.click(); await new Promise((resolve) => setTimeout(resolve, 120)) })()`)
    await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-activity.png'), await captureScreenshot(pageUrl))
  }
  await writeFile(join(workspace, '.serenity', 'modules.yaml'), YAML.stringify({ calendar: false, tasks: false, semanticIndex: false, documentAnalysis: false }))
  const watched = await evaluate(pageUrl, `(async () => { for (let i = 0; i < 50; i++) { const names = [...document.querySelectorAll('.navigation button')].map((item) => item.textContent ?? ''); if (!names.some((name) => name.includes('Tasks'))) return true; await new Promise((resolve) => setTimeout(resolve, 100)) } return false })()`)
  assert.equal(watched, true, 'Outside edits to module settings should update the desktop UI')
  if (process.env.SERENITY_SMOKE_SCREENSHOT_DIR) {
    const narrow = await evaluate(pageUrl, `(async () => { window.resizeTo(900, 760); for (let i = 0; i < 30 && innerWidth <= 1020 && !document.querySelector('.serenity-studio')?.classList.contains('left-collapsed'); i++) await new Promise((resolve) => setTimeout(resolve, 100)); return { width: innerWidth, main: document.querySelector('#workspace-main')?.getBoundingClientRect().width, right: Boolean(document.querySelector('.assistant-sidebar')), rail: document.querySelector('.serenity-studio')?.classList.contains('left-collapsed') } })()`) as { width: number; main: number; right: boolean; rail: boolean }
    if (narrow.width <= 1020) {
      assert.ok(narrow.main > 250 && narrow.right && narrow.rail, `The compact workspace should keep navigation, main, and AI usable: ${JSON.stringify(narrow)}`)
      await writeFile(join(process.env.SERENITY_SMOKE_SCREENSHOT_DIR, 'serenity-compact.png'), await captureScreenshot(pageUrl))
    }
  }
  console.log('Electron workspace, entity, claim, PDF/DOCX search, reversible merges/tasks/calendar, and preload IPC passed.')
} finally {
  child.kill()
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
