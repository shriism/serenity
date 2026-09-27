// Times the desktop app on a large synthetic workspace (2,000 entities, 8,000 claims, 300 tasks, a 200-message
// conversation) and fails if an interaction exceeds its budget. Run with `npm run perf:desktop` on a graphical desktop.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import YAML from 'yaml'
import { Workspace } from '../src/main/workspace'
const electron = createRequire(import.meta.url)('electron') as string
const dir = await mkdtemp(join(tmpdir(), 'serenity-perf-'))
const profile = await mkdtemp(join(tmpdir(), 'serenity-perf-profile-'))
const ws = new Workspace(dir); await ws.initialize(); ws.close()
const first = ['Alex', 'Sam', 'Priya', 'Jordan', 'Maria', 'Chen', 'Omar', 'Lena', 'Ravi', 'Noah']
const ids: string[] = []
const now = new Date().toISOString()
for (let i = 0; i < 2000; i++) { const id = randomUUID(); ids.push(id); await writeFile(join(dir, 'entities', `${id}.md`), `---\nid: ${id}\ntitle: ${first[i % 10]} ${['Rivera','Kim','Patel','Lee','Garcia'][i % 5]} ${i}\ntype: ${i % 3 ? 'person' : 'project'}\n---\nNotes about [[${first[(i + 1) % 10]} Kim ${(i + 1) % 2000}]] and entity ${i}.\n`) }
for (let i = 0; i < 8000; i++) { const id = randomUUID(); await writeFile(join(dir, 'claims', `${id}.yaml`), YAML.stringify({ id, subject: ids[i % 2000], key: i % 2 ? 'knows' : 'note', value: i % 2 ? ids[(i * 7) % 2000] : `value ${i}`, source: 'Bench', origin: 'human', status: 'confirmed', recordedAt: new Date(Date.now() - i * 60000).toISOString() })) }
for (let i = 0; i < 300; i++) { const id = randomUUID(); await writeFile(join(dir, 'tasks', `${id}.yaml`), YAML.stringify({ id, title: `Task ${i}`, completed: false, notes: '', relatedEntityIds: [ids[i]], recordedAt: now, due: new Date(Date.now() + (i - 150) * 86400000).toISOString().slice(0, 10) })) }
const conv = randomUUID(); await writeFile(join(dir, 'conversations', `${conv}.yaml`), YAML.stringify({ id: conv, title: 'Long chat', retained: true, messages: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', provider: 'codex', text: `Message ${i} `.repeat(20), recordedAt: now })) }))
const port = 20000 + Math.floor(Math.random() * 30000)
const started = Date.now()
const child = spawn(electron, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--background', '.', `--workspace=${dir}`], { stdio: ['ignore', 'ignore', 'pipe'] })
let appErrors = ''
child.stderr!.on('data', (d) => { appErrors += d })
const call = (url: string, expression: string) => new Promise<any>((resolve) => { const timer = setTimeout(() => resolve('TIMED OUT after 45 s: ' + expression.slice(0, 80)), 45000); const s = new WebSocket(url); s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); s.onmessage = (e) => { const r = JSON.parse(String(e.data)); if (r.id === 1) { clearTimeout(timer); s.close(); resolve(r.result?.result?.value ?? r.result) } } })
try {
  let url = ''
  for (let i = 0; i < 120 && !url; i++) { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]; url = pages.find((p) => p.type === 'page')?.webSocketDebuggerUrl ?? '' } catch {} await delay(250) }
  const ready = await call(url, `(async () => { for (let i = 0; i < 400; i++) { if (document.querySelector('.navigation button')) return true; await new Promise(r => setTimeout(r, 50)) } return false })()`)
  const launch = Date.now() - started
  console.log(`launch to navigation: ${launch} ms (budget 15000 ms)`)
  assert.equal(ready, true, 'the window should show its navigation')
  assert.ok(launch < 15000, 'launch took too long')
  const over: string[] = []
  const timed = async (label: string, action: string, done: string, budget = 1000) => {
    const result = await call(url, `(async () => { const t = performance.now(); ${action}; for (let i = 0; i < 600; i++) { if (${done}) break; await new Promise(r => setTimeout(r, 10)) } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t) })()`)
    console.log(`${label}: ${result} ms (budget ${budget} ms)`)
    if (typeof result !== 'number' || result > budget) over.push(`${label}: ${result}`)
  }
  const nav = (name: string) => `[...document.querySelectorAll('.navigation button')].find((b) => b.textContent.includes('${name}')).click()`
  await timed('Knowledge tiles', nav('Knowledge'), `document.querySelectorAll('.knowledge-tiles button').length > 100`)
  await timed('Graph', `[...document.querySelectorAll('.library-mode button')].find((b) => b.textContent.includes('Graph')).click()`, `document.querySelectorAll('.graph-node').length > 10`)
  await timed('Back to tiles', `[...document.querySelectorAll('.library-mode button')].find((b) => b.textContent.includes('Tiles')).click()`, `document.querySelector('.knowledge-tiles')`)
  await timed('Open entity', `document.querySelector('.knowledge-tiles button').click()`, `document.querySelector('.editor .title-input')`)
  await timed('Timeline', `[...document.querySelectorAll('.presentation-switcher button')].find((b) => b.textContent === 'Timeline').click()`, `document.querySelector('.entity-timeline')`)
  await timed('Connections', `[...document.querySelectorAll('.presentation-switcher button')].find((b) => b.textContent === 'Connections').click()`, `document.querySelector('.entity-connections')`)
  await timed('Profile', `[...document.querySelectorAll('.presentation-switcher button')].find((b) => b.textContent === 'Profile').click()`, `document.querySelector('.editor .title-input')`)
  const typing = await call(url, `(async () => { const input = document.querySelector('.editor .title-input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const t = performance.now(); for (let i = 0; i < 20; i++) { setter.call(input, input.value + 'x'); input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(r)) } return Math.round((performance.now() - t) / 20) })()`)
  console.log(`typing: ${typing} ms per key (budget 50 ms)`)
  if (typeof typing !== 'number' || typing > 50) over.push(`typing: ${typing}`)
  await timed('Review (duplicates)', `window.confirm = () => true; ${nav('Review')}`, `document.querySelector('.review-source') || document.querySelector('.page h1')`)
  await timed('Tasks', nav('Tasks'), `document.querySelector('.page h1')`)
  await timed('Activity', nav('Activity'), `document.querySelector('.activity-row')`)
  await timed('Home', nav('Home'), `document.querySelector('.home-page h1')`)
  await timed('Split right', `document.querySelector('.topbar-icon[aria-label="Split right"]').click()`, `document.querySelectorAll('.editor-group').length === 2`)
  // Let the background search index settle, as it would between a person's actions.
  await delay(2500)
  await timed('Search palette', `document.querySelector('.topbar-search').click()`, `document.querySelector('.palette-input input')`)
  await timed('Search "Alex Rivera"', `const input = document.querySelector('.palette-input input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Alex Rivera'); input.dispatchEvent(new Event('input', { bubbles: true }))`, `document.querySelectorAll('.palette-results button').length > 3`)
  console.log(await call(url, `(async () => { const m = performance.memory; return 'JS heap ' + Math.round(m.usedJSHeapSize / 1048576) + ' MB' })()`))
  assert.deepEqual(over, [], 'interactions over budget')
  console.log('Desktop performance within budget.')
} catch (error) { console.error(appErrors.slice(-2000)); throw error } finally { child.kill('SIGKILL'); await delay(500); await rm(dir, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }) }
