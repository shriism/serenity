// Times the desktop app on a large synthetic workspace (2,000 entities, 8,000 claims, 300 tasks, a 200-message
// conversation) and fails if an interaction exceeds its budget. Run with `npm run perf:desktop` on a graphical desktop.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import YAML from 'yaml'
import { Workspace } from '../src/main/workspace'
import { helpers, launch } from './electron-harness'
const dir = await mkdtemp(join(tmpdir(), 'serenity-perf-'))
const ws = new Workspace(dir); await ws.initialize(); ws.close()
const first = ['Alex', 'Sam', 'Priya', 'Jordan', 'Maria', 'Chen', 'Omar', 'Lena', 'Ravi', 'Noah']
const ids: string[] = []
const now = new Date().toISOString()
for (let i = 0; i < 2000; i++) { const id = randomUUID(); ids.push(id); await writeFile(join(dir, 'entities', `${id}.md`), `---\nid: ${id}\ntitle: ${first[i % 10]} ${['Rivera','Kim','Patel','Lee','Garcia'][i % 5]} ${i}\ntype: ${i % 3 ? 'person' : 'project'}\n---\nNotes about [[${first[(i + 1) % 10]} Kim ${(i + 1) % 2000}]] and entity ${i}.\n`) }
for (let i = 0; i < 8000; i++) { const id = randomUUID(); await writeFile(join(dir, 'claims', `${id}.yaml`), YAML.stringify({ id, subject: ids[i % 2000], key: i % 2 ? 'knows' : 'note', value: i % 2 ? ids[(i * 7) % 2000] : `value ${i}`, source: 'Bench', origin: 'human', status: 'confirmed', recordedAt: new Date(Date.now() - i * 60000).toISOString() })) }
for (let i = 0; i < 300; i++) { const id = randomUUID(); await writeFile(join(dir, 'tasks', `${id}.yaml`), YAML.stringify({ id, title: `Task ${i}`, completed: false, notes: '', relatedEntityIds: [ids[i]], recordedAt: now, due: new Date(Date.now() + (i - 150) * 86400000).toISOString().slice(0, 10) })) }
const conv = randomUUID(); await writeFile(join(dir, 'conversations', `${conv}.yaml`), YAML.stringify({ id: conv, title: 'Long chat', retained: true, messages: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', provider: 'codex', text: `Message ${i} `.repeat(20), recordedAt: now })) }))
const started = Date.now()
const app = await launch(dir, { width: 1440, height: 900 })
const run = <T = unknown>(script: string) => app.evaluate<T>(`(async () => { ${helpers} ${script} })()`, 45000)
try {
  const ready = await run(`return Boolean(await waitFor(() => $('.ribbon-btn') && $('.pane'), 20000))`)
  const launched = Date.now() - started
  console.log(`launch to workbench: ${launched} ms (budget 15000 ms)`)
  assert.equal(ready, true, 'the window should show its workbench')
  assert.ok(launched < 15000, 'launch took too long')
  const over: string[] = []
  const timed = async (label: string, action: string, done: string, budget = 1000) => {
    const result = await run(`const t = performance.now(); ${action}; for (let i = 0; i < 600; i++) { if (${done}) break; await sleep(10) } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t)`)
    console.log(`${label}: ${result} ms (budget ${budget} ms)`)
    if (typeof result !== 'number' || result > budget) over.push(`${label}: ${result}`)
  }
  const ribbon = (name: string) => `click($$('.ribbon-btn').find((b) => (b.getAttribute('aria-label') ?? '').startsWith('${name}')))`
  await timed('Knowledge tiles', ribbon('Knowledge'), `$$('.knowledge-tiles button').length > 100`)
  await timed('Graph', `click(byText('.library-mode button', 'Graph'))`, `$$('.graph-node').length > 10`)
  await timed('Back to tiles', `click(byText('.library-mode button', 'Tiles'))`, `$('.knowledge-tiles')`)
  await timed('Open entity', `click($('.knowledge-tiles button'))`, `$('.entity-document .cm-content')`)
  await timed('Timeline', `click(byText('.presentation-switcher button', 'Timeline'))`, `$('.entity-timeline')`)
  await timed('Connections', `click(byText('.presentation-switcher button', 'Connections'))`, `$('.entity-connections')`)
  await timed('Profile', `click(byText('.presentation-switcher button', 'Profile'))`, `$('.entity-document .cm-content')`)
  await run(`focusEnd($('.entity-document .cm-content'))`)
  const typingStart = Date.now()
  for (let i = 0; i < 20; i++) { await app.send('Input.insertText', { text: 'x' }); await run('await new Promise(r => requestAnimationFrame(r))') }
  const typing = Math.round((Date.now() - typingStart) / 20)
  console.log(`typing: ${typing} ms per key, including the automation round trip (budget 50 ms)`)
  if (typing > 50) over.push(`typing: ${typing}`)
  await timed('Explorer filter', `click($('.sidebar-actions [aria-label="Filter files"]')); await sleep(0); setValue($('.sidebar-filter input'), 'Rivera 1')`, `$$('.tree-row').length > 5`)
  await timed('Review (duplicates)', `window.confirm = () => true; ${ribbon('Review')}`, `$('.review-source') || $('.empty-state')`)
  await timed('Tasks', ribbon('Tasks'), `$('.module-page')`)
  await timed('Activity', ribbon('Activity'), `$('.activity-row')`)
  await timed('Home', ribbon('Home'), `$('.page-document .cm-content')`)
  await timed('Split right', `click($('[aria-label^="Pane actions"]')); await sleep(0); click(byText('.menu-item', 'Split right'))`, `$$('.pane').length === 2`)
  await timed('Chat mode', `click(byText('.mode-switch button', 'Chat'))`, `$$('.chat-main .message').length > 10 || $('.chat-main .composer')`)
  await run(`click(byText('.mode-switch button', 'Workspace')); await waitFor(() => $('.pane'))`)
  // Let the background search index settle after opening and the edits above (it warms 4 s after opening), as it would between a person's actions.
  await new Promise((resolve) => setTimeout(resolve, 6000))
  await timed('Search palette', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: navigator.platform.includes('Mac'), ctrlKey: !navigator.platform.includes('Mac'), bubbles: true }))`, `$('.palette-input input')`)
  await timed('Search "Alex Rivera"', `setValue($('.palette-input input'), 'Alex Rivera')`, `$$('.palette-results button').length > 3`)
  console.log(await run(`const m = performance.memory; return 'JS heap ' + Math.round(m.usedJSHeapSize / 1048576) + ' MB'`))
  assert.deepEqual(over, [], 'interactions over budget')
  console.log('Desktop performance within budget.')
} catch (error) { console.error(app.logs().slice(-2000)); throw error } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
