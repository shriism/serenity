// Drives the desktop app end to end against a temporary workspace: files, IPC, the workbench, editing, search,
// modules, review, accessibility, and recovery from a crashed renderer. `npm run smoke:desktop`.
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import YAML from 'yaml'
import { helpers, launch } from './electron-harness'

const require = createRequire(import.meta.url)
const executable = process.env.SERENITY_SMOKE_EXECUTABLE
if (executable) {
  const resources = process.platform === 'darwin' ? join(dirname(executable), '..', 'Resources') : join(dirname(executable), 'resources')
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
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}
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
await writeFile(join(workspace, 'documents', 'notes.md'), `# Intro\n${'x'.repeat(155000)}\n## Deep section\nA useful observation.\n`)
await writeFile(join(workspace, 'documents', 'unreadable.bin'), 'Not a supported document type')

const provider = process.env.SERENITY_SMOKE_PROVIDER
const app = await launch(workspace, { executable, keepProfile: Boolean(provider), width: 1400, height: 880 })
const screenshots = process.env.SERENITY_SMOKE_SCREENSHOT_DIR
const run = <T = unknown>(script: string, timeout?: number) => app.evaluate<T>(`(async () => { ${helpers} ${script} })()`, timeout)
const shot = async (name: string) => { if (screenshots) await writeFile(join(screenshots, `${name}.png`), await app.screenshot()) }
/** Types into the focused element as a person would, so editors see ordinary input events. */
const type = (text: string) => app.send('Input.insertText', { text })
const key = (key: string, modifiers = 0) => app.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0), modifiers }).then(() =>
  app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers }))
const mod = process.platform === 'darwin' ? 4 : 2
const until = async (label: string, check: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await check()) return; await delay(100) }
  assert.fail(`Timed out waiting for ${label}`)
}

try {
  assert.equal(await app.evaluate('window.serenity.refresh().then((snapshot) => snapshot?.path)'), workspace)
  // The workspace is remembered for the next launch, and only remembered folders can be reopened from the list.
  const remembered = await app.evaluate<{ path: string }[]>('window.serenity.recentWorkspaces()')
  assert.equal(remembered[0]?.path, workspace)
  assert.match(await app.evaluate<string>(`window.serenity.openRecentWorkspace('/').then(() => 'opened', (error) => String(error))`), /not in the recent list/)

  // A new workspace opens on its Home page: an editable Markdown file with live lists.
  const home = await run<{ title: string; review: string }>(`await waitFor(() => $('.page-document .cm-content') && $$('.page-query-list').length);
    return { title: $('.inline-title')?.value, review: $$('.page-query-list').map((list) => list.textContent).join(' | ') }`)
  assert.equal(home.title, 'Home')
  assert.match(home.review, /Alex/, 'Home should render a live review list from its Markdown file')
  assert.match(await readFile(join(workspace, 'pages', 'Home.md'), 'utf8'), /```serenity-query/)
  await shot('serenity-home')

  // Live preview editing, saved without a Save button.
  await run(`const content = $('.page-document .cm-content'); focusEnd(content)`)
  await type('\n## Sources\n\n```serenity-query\nfrom: documents\nlimit: 3\n```\n\nSee [[Home]] and [[Nobody here]].')
  await until('the page to save', async () => /## Sources[\s\S]*from: documents/.test(await readFile(join(workspace, 'pages', 'Home.md'), 'utf8')))
  const rendered = await run<{ documents: boolean; resolved: number; missing: number }>(`$('.page-document .cm-content').blur(); await sleep(300);
    return { documents: $$('.page-query-list').some((list) => list.textContent.includes('research.pdf')), resolved: $$('.cm-wikilink.resolved').length, missing: $$('.cm-wikilink.missing').length }`)
  assert.deepEqual(rendered, { documents: true, resolved: 1, missing: 1 }, 'New query blocks render as live lists, and wikilinks resolve by title or say they match nothing')
  // Renaming a page through its inline title writes the frontmatter.
  await run(`const title = $('.inline-title'); title.focus(); setValue(title, 'My Home'); title.blur()`)
  await until('the title to save', async () => /title: My Home/.test(await readFile(join(workspace, 'pages', 'Home.md'), 'utf8')))

  // The explorer lists the workspace; the ribbon opens views as tabs; the assistant has one toggle.
  const shell = await run<{ explorer: string[]; toggles: number; ribbon: string[] }>(`return { explorer: $$('.tree-row .tree-label').map((item) => item.textContent),
    toggles: $$('button[aria-label="Hide assistant"], button[aria-label="Show assistant"]').length, ribbon: $$('.ribbon-btn').map((item) => item.getAttribute('aria-label')) }`)
  assert.ok(shell.explorer.includes('My Home') && shell.explorer.includes('research.pdf'), `Explorer: ${shell.explorer}`)
  assert.equal(shell.toggles, 1, 'Exactly one control shows or hides the assistant')
  assert.ok(shell.ribbon.includes('Calendar') && shell.ribbon.includes('Settings'), `Ribbon: ${shell.ribbon}`)
  const hidden = await run(`click($('button[aria-label="Hide assistant"]')); await waitFor(() => !$('.right-sidebar')); const shown = Boolean($('button[aria-label="Show assistant"]'));
    click($('button[aria-label="Show assistant"]')); await waitFor(() => $('.right-sidebar')); return shown && $$('button[aria-label="Hide assistant"]').length === 1`)
  assert.equal(hidden, true, 'The same single toggle hides and shows the assistant')

  // New entity dialog, notes with a wikilink, a sourced fact, and other views of the entity.
  await run(`click(byText('.sidebar-actions button', 'New entity')); await waitFor(() => $('#new-entity-title'));
    setValue($('#new-entity-title'), 'Sam Rivera'); setValue($('#new-entity-type'), 'person'); await sleep(50); click(byText('.dialog button', 'Create'));
    await waitFor(() => $('.entity-document') && $('.inline-title')?.value === 'Sam Rivera')`)
  const entityId = await app.evaluate<string>(`window.serenity.refresh().then((snapshot) => snapshot.entities.find((entity) => entity.title === 'Sam Rivera').id)`)
  await run(`focusEnd($('.entity-document .cm-content'))`)
  await type('Leads the [[My Home]] project.')
  await until('the entity notes to save', async () => /\[\[My Home\]\]/.test(await readFile(join(workspace, 'entities', `${entityId}.md`), 'utf8')))
  await run(`click($('.facts [aria-label="Add a fact"]')); await waitFor(() => $('.fact-form'));
    setValue($('.fact-form [aria-label="Fact"]'), 'birthday'); setValue($('.fact-form [aria-label="Value"]'), 'September 7'); await sleep(50);
    $('.fact-form').requestSubmit(); await waitFor(() => $$('.fact').some((fact) => fact.textContent.includes('September 7')))`)
  const claimFiles = await readdir(join(workspace, 'claims'))
  assert.ok(claimFiles.length >= 1, 'Adding a fact writes a claim file')
  const presentations = await run<string[]>(`const seen = [];
    for (const name of ['Timeline', 'Connections', 'Profile']) { click(byText('.presentation-switcher button', name)); await sleep(250); seen.push(name + ':' + Boolean($('.entity-timeline, .entity-connections, .entity-document'))) }
    return seen`)
  assert.deepEqual(presentations, ['Timeline:true', 'Connections:true', 'Profile:true'])
  await shot('serenity-entity')

  // Panes: split, open beside, move a tab, and close a pane without losing files.
  const panes = await run<{ split: number; moved: boolean; closed: number }>(`click($('[aria-label^="Pane actions"]')); await sleep(80); click(byText('.menu-item', 'Split right'));
    await waitFor(() => $$('.pane').length === 2); const split = $$('.pane').length;
    click(byText('.tree-row', 'research.pdf')); await waitFor(() => $('.pane.focused .document-text'));
    click($$('[aria-label^="Pane actions"]')[1]); await sleep(80); click(byText('.menu-item', 'Move tab to next pane')); await sleep(200);
    const moved = $$('.pane')[0].textContent.includes('research.pdf');
    click($$('[aria-label^="Pane actions"]')[1]); await sleep(80); click(byText('.menu-item', 'Close pane')); await waitFor(() => $$('.pane').length === 1);
    return { split, moved, closed: $$('.pane').length }`)
  assert.deepEqual(panes, { split: 2, moved: true, closed: 1 })
  assert.ok((await stat(join(workspace, 'documents', 'research.pdf'))).isFile(), 'Closing a pane leaves files alone')

  // Search: PDF and DOCX text, excerpts, and keeping results in a pane.
  await key('k', mod)
  const results = await run<string[]>(`await waitFor(() => $('.palette-input input')); setValue($('.palette-input input'), 'QuarterlyCometResearch');
    await waitFor(() => $$('.palette-results button').some((item) => item.textContent.includes('research.pdf')), 8000);
    setValue($('.palette-input input'), 'DocxSyllabusDeadline'); await waitFor(() => $$('.palette-results button').some((item) => item.textContent.includes('syllabus.docx')), 8000);
    return $$('.palette-results button').map((item) => item.textContent)`)
  assert.ok(results.some((item) => item.includes('syllabus.docx') && item.includes('DocxSyllabusDeadline')), `Search results: ${results}`)
  const kept = await run(`click(byText('.palette-actions button', 'Keep results in a pane')); await waitFor(() => $$('.search-view-results button').length);
    return $('.tab.active')?.textContent.includes('Search')`)
  assert.equal(kept, true, 'Search results stay open in a Search tab')

  // Documents open as text with an outline; unsupported formats are marked.
  const documents = await run<{ text: boolean; outline: boolean; marked: boolean }>(`click(byText('.ribbon-btn', 'Documents')); await waitFor(() => $$('.document-row').length);
    const marked = $$('.document-row').some((row) => row.textContent.includes('unreadable.bin') && row.textContent.includes('opens in its app'));
    click(byText('.document-name', 'notes.md')); await waitFor(() => $('.document-text'));
    return { text: Boolean($('.document-text')), outline: Boolean(await waitFor(() => $('.document-outline'))), marked }`)
  assert.deepEqual(documents, { text: true, outline: true, marked: true })

  // Tasks and calendar: records written to the workspace, with their alternative views.
  const taskDue = futureDate(7)
  await run(`click(byText('.ribbon-btn', 'Tasks')); await waitFor(() => $('.module-form'));
    setValue($('.module-form input'), 'Buy Sam a gift'); setValue($('.module-form input[type="date"]'), '${taskDue}'); await sleep(50);
    $('.module-form').requestSubmit(); await waitFor(() => $$('.task-row').some((row) => row.textContent.includes('Buy Sam a gift')))`)
  const board = await run(`click(byText('.task-view-toggle button', 'Board')); await waitFor(() => $$('.task-board-column').length === 5);
    return $$('.task-board-card').some((card) => card.textContent.includes('Buy Sam a gift'))`)
  assert.equal(board, true)
  await run(`click(byText('.ribbon-btn', 'Calendar')); await waitFor(() => $('.calendar-grid') || $('.calendar-agenda'));
    click(byText('.module-aside button', '+ Add event')); await waitFor(() => $('.module-aside .module-form'));
    setValue($('.module-aside .module-form input'), 'Lunch with Sam'); await sleep(50); $('.module-aside .module-form').requestSubmit();
    await waitFor(() => $$('.module-record').some((item) => item.textContent.includes('Lunch with Sam')))`)
  const agenda = await run(`click(byText('.task-view-toggle button', 'Agenda')); await waitFor(() => $('.calendar-agenda'));
    return $$('.calendar-agenda button').map((item) => item.textContent).join(' | ')`)
  assert.match(String(agenda), /Lunch with Sam/)

  // Review: an AI-suggested entity can be created after review.
  const reviewed = await run(`click($('.ribbon-btn[aria-label^="Review"]')); await waitFor(() => $$('.review-card').length);
    click(byText('.review-card button', 'Create entity')); return Boolean(await waitFor(() => $$('.tree-row').some((row) => row.textContent === 'Alex')))`)
  assert.equal(reviewed, true)

  // Settings is a dialog: shortcuts, appearance, and module switches.
  const settings = await run<{ rows: number; light: boolean; calendarHidden: boolean; calendarBack: boolean }>(`click($('.ribbon-btn[aria-label="Settings"]')); await waitFor(() => $('.settings-dialog'));
    click(byText('.settings-nav button', 'Shortcuts')); await waitFor(() => $$('.settings-shortcuts tr').length); const rows = $$('.settings-shortcuts tbody tr').length;
    click(byText('.settings-nav button', 'General')); await sleep(50); click(byText('.settings-dialog .segmented button', 'Light')); await sleep(100);
    const light = document.documentElement.dataset.theme === 'light';
    click(byText('.settings-nav button', 'Modules')); await sleep(50); click($('.switch[aria-label="Calendar"]'));
    const calendarHidden = Boolean(await waitFor(() => !$$('.ribbon-btn').some((item) => item.getAttribute('aria-label') === 'Calendar')));
    click($('.switch[aria-label="Calendar"]')); const calendarBack = Boolean(await waitFor(() => $$('.ribbon-btn').some((item) => item.getAttribute('aria-label') === 'Calendar')));
    click(byText('.settings-nav button', 'General')); await sleep(50); click(byText('.settings-dialog .segmented button', 'Dark')); click($('.dialog-close'));
    return { rows, light, calendarHidden, calendarBack }`)
  assert.ok(settings.rows > 10, 'Settings lists every command with its shortcut')
  assert.deepEqual({ ...settings, rows: true }, { rows: true, light: true, calendarHidden: true, calendarBack: true })

  // Chat mode, and conversation settings for a read scope limited to chosen knowledge.
  const chat = await run<{ composer: boolean; scope: string }>(`click(byText('.ribbon-mode button', 'Chat')); await waitFor(() => $('.chat-main .composer'));
    click($('.chat-main .composer button[aria-label^="Read scope"]')); await waitFor(() => $('[role="radiogroup"][aria-label="AI read scope"]'));
    click(byText('[role="radio"]', 'Selected knowledge')); await sleep(80); const scope = $('.chat-main .composer button[aria-label^="Read scope"]').textContent;
    click(byText('[role="radio"]', 'Whole workspace')); click(byText('.dialog button', 'Done')); await sleep(80);
    const composer = Boolean($('.chat-main textarea[aria-label="Message"]')); click(byText('.ribbon-mode button', 'Workspace')); await waitFor(() => $('.pane'));
    return { composer, scope }`)
  assert.equal(chat.composer, true)
  assert.match(chat.scope, /0 selected/)
  await shot('serenity-chat')

  // The layout is kept with the workspace and restored when the window reloads.
  await run(`click($('[aria-label^="Pane actions"]')); await sleep(80); click(byText('.menu-item', 'Split down')); await waitFor(() => $$('.pane').length === 2); await sleep(400)`)
  await app.send('Page.reload')
  await delay(500)
  const restored = await run(`await waitFor(() => $$('.pane').length === 2, 10000); return $$('.pane').length`)
  assert.equal(restored, 2, 'Panes are restored with the workspace')

  if (provider === 'copilot' || provider === 'codex') {
    const answer = await app.evaluate<{ text: string; citations?: { ref: string; sent: boolean; quoteFound?: boolean }[]; shared: string[] }>(`window.serenity.sendMessage({ text: 'According to the sourced claim about Sam Rivera, what is their birthday? Include the date. Do not propose any changes.', provider: '${provider}', autonomy: 'propose', retained: true, activeRef: 'entity:${entityId}' }).then((snapshot) => { const conversation = snapshot.conversations.at(-1); const last = conversation.messages.at(-1); return { text: last.text, citations: last.citations, shared: conversation.messages[0].sharedContext?.flatMap((entry) => entry.records.map((record) => record.ref)) ?? [] } })`, 120000)
    assert.match(answer.text, /September 7/i)
    assert.ok(answer.shared.includes(`entity:${entityId}`), 'The focused entity is offered as context')
    assert.ok(answer.citations?.some((citation) => citation.ref.startsWith('claim:') && citation.sent), `Citations: ${JSON.stringify(answer.citations)}`)
    console.log(`${provider} conversation completed through Electron IPC.`)
  }

  // Accessibility gate: no serious or critical axe-core violations on the main views, in either theme.
  await app.evaluate(`${await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')};true`)
  const views: [string, string][] = [
    ['Home', `click($('.ribbon-btn[aria-label="Home"]'))`], ['Knowledge', `click(byText('.ribbon-btn', 'Knowledge'))`],
    ['Graph', `click(byText('.library-mode button', 'Graph'))`], ['Review', `click($('.ribbon-btn[aria-label^="Review"]'))`],
    ['Documents', `click(byText('.ribbon-btn', 'Documents'))`], ['Calendar', `click(byText('.ribbon-btn', 'Calendar'))`],
    ['Tasks', `click(byText('.ribbon-btn', 'Tasks'))`], ['Activity', `click(byText('.ribbon-btn', 'Activity'))`],
    ['Entity', `click(byText('.tree-row', 'Sam Rivera'))`], ['Timeline', `click(byText('.presentation-switcher button', 'Timeline'))`],
    ['New tab', `click($('.pane.focused .new-tab') ?? $('.new-tab'))`], ['Settings', `click($('.ribbon-btn[aria-label="Settings"]'))`],
    ['Chat', `click($('.dialog-close')); click(byText('.ribbon-mode button', 'Chat'))`]
  ]
  const accessibility: string[] = []
  for (const theme of ['dark', 'light']) {
    await run(`if ($('.dialog-close')) click($('.dialog-close')); if (byText('.ribbon-mode button', 'Workspace')) click(byText('.ribbon-mode button', 'Workspace')); await sleep(150)`)
    for (const [view, setup] of views) {
      const found = await run<string[]>(`document.documentElement.setAttribute('data-theme', '${theme}'); ${setup}; await sleep(400);
        await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
        const result = await axe.run(document, { resultTypes: ['violations'] });
        return result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => item.id + ' (' + item.nodes.length + ') at ' + item.nodes[0].target.join(' '))`)
      accessibility.push(...found.map((item) => `${theme} ${view}: ${item}`))
    }
  }
  assert.deepEqual(accessibility, [], 'Main views should have no serious or critical accessibility violations')

  // Crash the renderer on purpose: the window should reload itself with a working bridge and the same workspace.
  await app.send('Page.crash').catch(() => undefined)
  let recovered: unknown = null
  for (let attempt = 0; attempt < 60 && !recovered; attempt++) {
    await delay(250)
    recovered = await app.evaluate('window.serenity?.refresh().then((snapshot) => snapshot?.path) ?? null', 3000).catch(() => null)
  }
  assert.equal(recovered, workspace, 'A crashed window should reload into the same workspace')
  console.log('Desktop smoke passed: workspace files, live-preview editing, panes, search (PDF/DOCX), tasks, calendar, review, settings, chat, accessibility, and crash recovery.')
} finally {
  await app.close()
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
