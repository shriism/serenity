// Captures the main screens of the desktop UI for visual review: `npm run build && tsx tests/ui-screens.ts [directory]`.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { helpers, launch } from './electron-harness'

const output = process.argv[2] ?? join(tmpdir(), 'serenity-screens')
await mkdir(output, { recursive: true })
const workspace = await mkdtemp(join(tmpdir(), 'serenity-screens-'))
for (const folder of ['entities', 'claims', 'documents', 'pages', 'tasks', 'calendar', 'conversations', 'proposals']) await mkdir(join(workspace, folder), { recursive: true })
const ids = { alex: '11111111-1111-4111-8111-111111111111', maya: '22222222-2222-4222-8222-222222222222', robot: '33333333-3333-4333-8333-333333333333' }
const entity = (id: string, title: string, type: string, body: string) => writeFile(join(workspace, 'entities', `${id}.md`), `---\n${YAML.stringify({ id, title, type, origin: 'human' })}---\n${body}`)
await entity(ids.alex, 'Alex Rivera', 'person', 'Met Alex at the **robotics club** in 2024. Works with [[Maya Chen]] on the [[Rover project]].\n\n- Likes climbing\n- [ ] Send the parts list\n')
await entity(ids.maya, 'Maya Chen', 'person', 'Mentor for the club. Teaches *control systems*.')
await entity(ids.robot, 'Rover project', 'project', '## Goals\n\nBuild a small rover that maps the garden.\n\n> Keep it simple and cheap.\n')
const claim = (id: string, subject: string, key: string, value: string, source: string) => writeFile(join(workspace, 'claims', `${id}.yaml`),
  YAML.stringify({ id, subject, key, value, source, origin: 'human', status: 'confirmed', recordedAt: new Date().toISOString() }))
await claim('44444444-4444-4444-8444-444444444444', ids.alex, 'birthday', 'March 3', 'Me')
await claim('55555555-5555-4555-8555-555555555555', ids.alex, 'works with', ids.maya, 'Me')
await claim('66666666-6666-4666-8666-666666666666', ids.alex, 'role', 'Hardware lead', 'club-notes.md')
await writeFile(join(workspace, 'documents', 'club-notes.md'), '# Club notes\n\nAlex leads hardware. Maya mentors.\n')
const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
await writeFile(join(workspace, 'tasks', '77777777-7777-4777-8777-777777777777.yaml'), YAML.stringify({ id: '77777777-7777-4777-8777-777777777777', title: 'Order rover motors', due, completed: false, notes: '', relatedEntityIds: [ids.robot] }))
await writeFile(join(workspace, 'proposals', '88888888-8888-4888-8888-888888888888.yaml'), YAML.stringify({ id: '88888888-8888-4888-8888-888888888888', kind: 'entity', title: 'Jordan Lee',
  type: 'person', body: 'Joined the club in spring.', source: 'club-notes.md', origin: 'ai-inference', provider: 'copilot', conversationId: '99999999-9999-4999-8999-999999999999', status: 'pending', recordedAt: new Date().toISOString() }))

const app = await launch(workspace, { width: 1440, height: 900 })
const run = (script: string) => app.evaluate(`(async () => { ${helpers} ${script} })()`)
const shot = async (name: string) => { await run('await sleep(350)'); await writeFile(join(output, `${name}.png`), await app.screenshot()); console.log(join(output, `${name}.png`)) }
try {
  await run(`await waitFor(() => $('.cm-content'))`)
  await shot('01-home')
  await run(`click(byText('.tree-row', 'Alex Rivera')); await waitFor(() => $('.entity-document'))`)
  await shot('02-entity')
  await run(`click($('[aria-label^="Pane actions"]')); await sleep(100); click(byText('.menu-item', 'Split right')); await sleep(200); click(byText('.tree-row', 'Rover project')); await sleep(300)`)
  await shot('03-split')
  await run(`click(byText('.ribbon-btn', 'Calendar')); await sleep(300)`)
  await shot('04-calendar')
  await run(`click(byText('.mode-switch button', 'Chat')); await sleep(300)`)
  await shot('05-chat')
  const views: [string, string][] = [
    ['13-knowledge', `click(byText('.ribbon-btn', 'Knowledge'))`], ['14-graph', `click(byText('.library-mode button', 'Graph'))`],
    ['15-documents', `click(byText('.ribbon-btn', 'Documents'))`], ['16-document', `click(byText('.document-name', 'club-notes.md'))`],
    ['17-tasks', `click(byText('.ribbon-btn', 'Tasks'))`], ['18-activity', `click(byText('.ribbon-btn', 'Activity'))`],
    ['19-timeline', `click(byText('.tree-row', 'Alex Rivera')); await sleep(200); click(byText('.presentation-switcher button', 'Timeline'))`],
    ['20-connections', `click(byText('.presentation-switcher button', 'Connections'))`],
    ['21-new-entity', `click(byText('.sidebar-actions button', 'New entity'))`],
    ['22-settings-modules', `click($('.dialog-close')); await sleep(100); click($('.ribbon-btn[aria-label="Settings"]')); await sleep(200); click(byText('.settings-nav button', 'Modules'))`],
    ['23-settings-ai', `click(byText('.settings-nav button', 'AI providers'))`],
    ['24-menu', `click($('.dialog-close')); await sleep(100); click($('[aria-label^="Pane actions"]'))`],
    ['25-conversation-settings', `document.body.click(); await sleep(100); click($('.right-sidebar button[aria-label^="Read scope"]'))`]
  ]
  await run(`click(byText('.mode-switch button', 'Workspace')); await sleep(200)`)
  for (const [name, script] of views) { await run(`${script}; await sleep(350)`); await shot(`dark-${name}`) }
  await run(`if ($('.dialog-close')) click($('.dialog-close'))`)
  await run(`click(byText('.mode-switch button', 'Workspace')); await sleep(200); click($('.ribbon-btn[aria-label="Settings"]')); await sleep(300)`)
  await shot('06-settings')
  await run(`click(byText('.settings-dialog .segmented button', 'Light')); await sleep(200); click($('.dialog-close')); await sleep(200)`)
  await shot('07-light')
  await run(`click(byText('.ribbon-btn', 'Review, 1 waiting') ?? byText('.ribbon-btn', 'Review')); await sleep(300)`)
  await shot('08-review-light')
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: navigator.platform.includes('Mac'), ctrlKey: !navigator.platform.includes('Mac'), bubbles: true })); await sleep(150); const input = $('.palette-input input'); if (input) setValue(input, 'rover'); await sleep(400)`)
  await shot('09-palette-light')
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); click(byText('.tree-row', 'Alex Rivera')); await sleep(300)`)
  await shot('10-entity-light')
  await app.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 700, deviceScaleFactor: 2, mobile: false })
  await run(`window.dispatchEvent(new Event('resize')); await sleep(400)`)
  await shot('11-narrow')
  await run(`click($('button[aria-label="Show sidebar"]')); await sleep(300)`)
  await shot('12-narrow-sidebar')
} catch (error) { console.error(error); console.error(app.logs().slice(-3000)) }
finally { await app.close() }
