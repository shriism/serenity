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
import type { WorkspaceSnapshot } from '../src/shared/types'
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
await mkdir(join(workspace, 'conversations'))
await writeFile(join(workspace, 'conversations', '123e4567-e89b-42d3-a456-426614174093.yaml'), YAML.stringify({
  id: '123e4567-e89b-42d3-a456-426614174093', title: 'Robotics club notes', retained: true, messages: [
    { id: 'm1', role: 'user', text: 'Who did I meet at the robotics club?', recordedAt: new Date().toISOString() },
    { id: 'm2', role: 'assistant', provider: 'copilot', text: 'You met Alex. I suggested adding Alex as a person.', recordedAt: new Date().toISOString() }] }))
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
await writeFile(join(workspace, 'documents', 'old-draft.txt'), 'A draft to archive')

const provider = process.env.SERENITY_SMOKE_PROVIDER
// SERENITY_SMOKE_WINDOW (e.g. 900x640) runs everything in a small window, as CI machines with small screens do.
const smokeSize = (process.env.SERENITY_SMOKE_WINDOW ?? '1280x820').split('x').map(Number)
const app = await launch(workspace, { executable, keepProfile: Boolean(provider), windowSize: process.env.SERENITY_SMOKE_WINDOW,
  width: smokeSize[0], height: smokeSize[1] })
const screenshots = process.env.SERENITY_SMOKE_SCREENSHOT_DIR
const run = <T = unknown>(script: string, timeout?: number) => app.evaluate<T>(`(async () => { ${helpers} ${script} })()`, timeout)
const shot = async (name: string) => { if (screenshots) await writeFile(join(screenshots, `${name}.png`), await app.screenshot()) }
/** Types into the focused element as a person would, so editors see ordinary input events. */
const type = (text: string) => app.send('Input.insertText', { text })
const key = (key: string, modifiers = 0) => app.send('Input.dispatchKeyEvent', { type: key.startsWith('Arrow') ? 'rawKeyDown' : 'keyDown', key, code: /^\d$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key,
  windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 } as Record<string, number>)[key] ?? key.toUpperCase().charCodeAt(0), modifiers }).then(() =>
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

  // Arrow navigation into a live query reveals its editable source without a separate Edit button.
  const queryCount = await run<number>(`return $$('.page-document .cm-query').length`)
  await run(`const content = $('.page-document .cm-content'); const heading = $$('.page-document .cm-heading').find((line) => line.textContent.includes('Coming up'));
    content.focus(); const range = document.createRange(); range.selectNodeContents(heading); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); await sleep(80)`)
  for (let step = 0; step < 8 && await run<number>(`return $$('.page-document .cm-query').length`) === queryCount; step++) await key('ArrowDown')
  assert.equal(await run<number>(`return $$('.page-document .cm-query').length`), queryCount - 1, 'ArrowDown enters the query source')
  assert.match(await run<string>(`return $('.page-document .cm-content').textContent`), /```serenity-queryfrom: upcoming/, 'The query YAML is editable')

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
  // A cancelled title edit is not saved. Real keyboard events move focus into the body and back to reading.
  await run(`const title = $('.inline-title'); title.focus(); setValue(title, 'Discard this title')`)
  await key('Escape')
  assert.equal(await run(`return $('.inline-title').value`), 'My Home')
  assert.match(await readFile(join(workspace, 'pages', 'Home.md'), 'utf8'), /title: My Home/)
  await run(`$('.inline-title').focus()`)
  await key('Enter')
  assert.equal(await run(`return document.activeElement?.classList.contains('cm-content')`), true, 'Enter focuses the page body')
  await key('Escape')
  assert.equal(await run(`return document.activeElement?.classList.contains('cm-content')`), false, 'Escape leaves body editing')
  assert.equal(await run(`return getComputedStyle($('.pane-body'), '::-webkit-scrollbar').width`), '0px', 'Reading has no scrollbar gutter')

  // The explorer lists the workspace; the ribbon opens views as tabs; the assistant has one toggle.
  const shell = await run<{ explorer: string[]; toggles: number; ribbon: string[] }>(`await showSidebar(); return { explorer: $$('.tree-row .tree-label').map((item) => item.textContent),
    toggles: $$('button[aria-label="Hide assistant"], button[aria-label="Show assistant"]').length, ribbon: $$('.ribbon-btn').map((item) => item.getAttribute('aria-label')) }`)
  assert.ok(shell.explorer.includes('My Home') && shell.explorer.includes('research.pdf'), `Explorer: ${shell.explorer}`)
  assert.equal(shell.toggles, 1, 'Exactly one control shows or hides the assistant')
  assert.ok(shell.ribbon.includes('Calendar') && shell.ribbon.includes('Settings'), `Ribbon: ${shell.ribbon}`)
  const hidden = await run(`if ($('button[aria-label="Show assistant"]')) { click($('button[aria-label="Show assistant"]')); await waitFor(() => $('.right-sidebar[aria-hidden="false"]')) }
    const before = $('.assistant-edge-toggle').getBoundingClientRect().x;
    click($('button[aria-label="Hide assistant"]')); await waitFor(() => $('.right-sidebar[aria-hidden="true"]')); const shown = Boolean($('button[aria-label="Show assistant"]'));
    click($('button[aria-label="Show assistant"]')); await waitFor(() => $('.right-sidebar[aria-hidden="false"]'));
    return shown && $$('button[aria-label="Hide assistant"]').length === 1 && Math.abs($('.assistant-edge-toggle').getBoundingClientRect().x - before) < 1`)
  assert.equal(hidden, true, 'The same single toggle hides and shows the assistant')
  const contextMenu = await run<string[]>(`await showSidebar(); const row = byText('.tree-row', 'research.pdf'); const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 5 }));
    await waitFor(() => $('.menu.context')); const labels = $$('.menu.context .menu-label').map((item) => item.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); $('.menu.context')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(50); return labels`)
  assert.deepEqual(contextMenu, ['Open', 'Open in next pane', 'Copy link', 'Move to archive…'], 'Files have a right-click menu')
  // Archiving moves a file aside rather than deleting it.
  await run(`window.confirm = () => true; const row = byText('.tree-row', 'old-draft.txt'); const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 5 }));
    await waitFor(() => $('.menu.context')); click(byText('.menu.context .menu-item', 'Move to archive…'));
    await waitFor(() => !$$('.tree-row').some((item) => item.textContent === 'old-draft.txt'))`)
  assert.ok((await stat(join(workspace, 'archive', 'documents', 'old-draft.txt'))).isFile(), 'An archived document moves to archive/documents')

  // New entity dialog, notes with a wikilink, a sourced fact, and other views of the entity.
  await run(`await showSidebar(); click(byText('.sidebar-actions button', 'New entity')); await waitFor(() => $('#new-entity-title'));
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

  // ⌘/Ctrl-1 shows the first tab and 9 the last.
  await key('1', mod)
  assert.match(await run<string>(`await sleep(100); return $('.tab.active')?.textContent ?? ''`), /My Home/, 'Mod+1 shows the first tab')
  await key('9', mod)
  assert.match(await run<string>(`await sleep(100); return $('.tab.active')?.textContent ?? ''`), /Sam Rivera/, 'Mod+9 shows the last tab')
  const tabCount = await run<number>(`return $$('.tab').length`)
  await key('w', mod)
  assert.equal(await run<number>(`await sleep(100); return $$('.tab').length`), tabCount - 1, 'Mod+W closes the active tab')

  // Panes: split, open beside, move a tab, and close a pane without losing files.
  const panes = await run<{ split: number; moved: boolean; closed: number }>(`click($('[aria-label^="Pane actions"]')); await sleep(80); click(byText('.menu-item', 'Split right'));
    await waitFor(() => $$('.pane').length === 2); const split = $$('.pane').length;
    await showSidebar(); click(byText('.tree-row', 'research.pdf')); await waitFor(() => $('.pane.focused .document-text'));
    click($$('[aria-label^="Pane actions"]')[1]); await sleep(80); click(byText('.menu-item', 'Move tab to next pane')); await sleep(200);
    const moved = $$('.pane')[0].textContent.includes('research.pdf');
    click($$('[aria-label^="Pane actions"]')[1]); await sleep(80); click(byText('.menu-item', 'Close pane')); await waitFor(() => $$('.pane').length === 1);
    return { split, moved, closed: $$('.pane').length }`)
  assert.deepEqual(panes, { split: 2, moved: true, closed: 1 })
  assert.ok((await stat(join(workspace, 'documents', 'research.pdf'))).isFile(), 'Closing a pane leaves files alone')
  // Releasing a dragged divider must restore ordinary clicks and typing, even after the pointer moved far away.
  await run(`click($('[aria-label^="Pane actions"]')); await sleep(80); click(byText('.menu-item', 'Split right')); await waitFor(() => $$('.pane').length === 2)`)
  const divider = await run<{ x: number; y: number } | null>(`const rect = $('.pane-divider.row')?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null`)
  if (divider) {
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: divider.x, y: divider.y, button: 'left', clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: divider.x + 50, y: divider.y, button: 'left', buttons: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: divider.x + 130, y: divider.y, button: 'left', clickCount: 1 })
  }
  await delay(300)
  const narrowAfterResize = await run<boolean>(`return $('.app').classList.contains('narrow')`)
  if (narrowAfterResize) { await key('j', mod | 8); await run(`await waitFor(() => $('.chat-main .composer textarea'))`) }
  const composerSelector = narrowAfterResize ? '.chat-main .composer textarea' : '.assistant-panel .composer textarea'
  for (let attempt = 0; attempt < 3 && !await run<boolean>(`return document.activeElement === $('${composerSelector}')`); attempt++) {
    const composerPoint = await run<{ x: number; y: number }>(`const rect = $('${composerSelector}').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }`)
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: composerPoint.x, y: composerPoint.y, button: 'left', clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: composerPoint.x, y: composerPoint.y, button: 'left', clickCount: 1 })
    await delay(100)
  }
  assert.equal(await run<boolean>(`return document.activeElement === $('${composerSelector}')`), true, 'Clicking the composer focuses it after a pane drag')
  await type('Typing works after resize')
  assert.equal(await run(`return $('${composerSelector}').value`), 'Typing works after resize')
  await run(`setValue($('${composerSelector}'), ''); ${narrowAfterResize ? "click($('.chat-header [aria-label=\"Return chat to sidebar\"]')); await waitFor(() => $('.pane'));" : ''}
    click($$('.pane')[1].querySelector('.tab-close')); await waitFor(() => $$('.pane').length === 1)`)

  await key('o', mod)
  const fileSearch = await run(`await waitFor(() => $('.command-palette[aria-label="Open file in workspace"]'));
    setValue($('.palette-input input'), 'research.pdf'); await sleep(50);
    return $$('.palette-results button').map((item) => item.textContent)`)
  assert.ok(fileSearch.some((item: string) => item.includes('research.pdf')), 'Mod+O finds files in the workspace')
  await key('Escape')

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

  // Markdown documents open for editing with an outline; PDF and Word documents are read; unsupported formats are marked.
  const documents = await run<{ text: boolean; outline: boolean; marked: boolean; pdf: boolean }>(`click(byText('.ribbon-btn', 'Documents')); await waitFor(() => $$('.document-row').length);
    const marked = $$('.document-row').some((row) => row.textContent.includes('unreadable.bin') && row.textContent.includes('opens in its app'));
    click(byText('.document-name', 'notes.md')); await waitFor(() => $('.document-view .cm-content'), 8000);
    const outline = Boolean(await waitFor(() => $('.document-outline'))); const text = Boolean($('.document-view .cm-content'));
    click(byText('.ribbon-btn', 'Documents')); await waitFor(() => $$('.document-row').length); click(byText('.document-name', 'research.pdf'));
    return { text, outline, marked, pdf: Boolean(await waitFor(() => $('.document-text'))) }`)
  assert.deepEqual(documents, { text: true, outline: true, marked: true, pdf: true })
  // New creates a Markdown document that is edited and saved in place.
  await run(`click(byText('.ribbon-btn', 'Documents')); await waitFor(() => $$('.document-row').length); click(byText('.view-actions button', 'New'));
    await waitFor(() => $('.document-file-title')?.textContent === 'Untitled.md'); await sleep(150); focusEnd($('.document-view .cm-content'))`)
  await type('Meeting notes for Sam')
  if (!await run<boolean>(`return $('.document-view .cm-content')?.textContent.includes('Meeting notes for Sam')`)) {
    await run(`focusEnd($('.document-view .cm-content'))`)
    await type('Meeting notes for Sam')
  }
  assert.equal(await run<boolean>(`return $('.document-view .cm-content')?.textContent.includes('Meeting notes for Sam')`), true, 'Typing reaches the new document editor')
  await until('the new document to save', async () => (await readFile(join(workspace, 'documents', 'Untitled.md'), 'utf8').catch(() => '')) === 'Meeting notes for Sam')

  // Tasks and calendar: records written to the workspace, with their alternative views.
  const taskDue = futureDate(7)
  await run(`click(byText('.ribbon-btn', 'Tasks')); await waitFor(() => $('.module-form'));
    setValue($('.module-form input'), 'Buy Sam a gift'); setValue($('.module-form input[type="date"]'), '${taskDue}'); await sleep(50);
    $('.module-form').requestSubmit(); await waitFor(() => $$('.task-row').some((row) => row.textContent.includes('Buy Sam a gift')))`)
  const board = await run(`click(byText('.task-view-toggle button', 'Board')); await waitFor(() => $$('.task-board-column').length === 5);
    return $$('.task-board-card').some((card) => card.textContent.includes('Buy Sam a gift'))`)
  assert.equal(board, true)
  await run(`click(byText('.ribbon-btn', 'Calendar')); await waitFor(() => $('.fc-daygrid') || $('.calendar-agenda'));
    click($('.calendar-add')); await waitFor(() => $('.calendar-event-dialog .module-form'))`)
  await run(`await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))`)
  await shot('serenity-calendar-event-dialog')
  await run(`
    setValue($('.calendar-event-dialog .module-form input'), 'Lunch with Sam'); await sleep(50); $('.calendar-event-dialog .module-form').requestSubmit();
    await waitFor(() => $$('.fc-event').some((item) => item.textContent.includes('Lunch with Sam')))`)
  const calendarViews = await run<string[]>(`const seen = [];
    for (const [name, selector] of [['Week', '.fc-timegrid'], ['Day', '.fc-timegrid'], ['Month', '.fc-daygrid']]) {
      click(byText('.task-view-toggle button', name)); await waitFor(() => $(selector)); seen.push(name + ':' + Boolean($$('.fc-event').some((item) => item.textContent.includes('Lunch with Sam')))) }
    return seen`)
  assert.deepEqual(calendarViews, ['Week:true', 'Day:true', 'Month:true'], 'Calendar keeps workspace events in each FullCalendar view')
  const editedEvent = await run(`click($$('.fc-event').find((item) => item.textContent.includes('Lunch with Sam')));
    await waitFor(() => $('.calendar-event-dialog .module-form input')?.value === 'Lunch with Sam');
    setValue($('.calendar-event-dialog .module-form input'), 'Lunch with Sam at noon'); await sleep(50); $('.calendar-event-dialog .module-form').requestSubmit();
    return Boolean(await waitFor(() => $$('.fc-event').some((item) => item.textContent.includes('Lunch with Sam at noon'))))`)
  assert.equal(editedEvent, true, 'Editing a FullCalendar event saves through Serenity')
  if (!(await run<boolean>(`return $('.app').classList.contains('narrow')`))) {
    await until('the calendar editor to close', () => run<boolean>(`return !$('.calendar-event-dialog')`))
    // Keep the event in this month so the following Agenda checks also work on its last day.
    const dropDate = futureDate(new Date().getDate() === 1 ? 1 : -1)
    const eventDrag = await run<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`const item = $$('.fc-event').find((element) => element.textContent.includes('Lunch with Sam at noon'));
      item.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(120);
      const event = item.getBoundingClientRect();
      const day = $('.fc-daygrid-day[data-date="${dropDate}"]').getBoundingClientRect();
      const from = { x: event.x + event.width / 2, y: event.y + event.height / 2 };
      const to = { x: day.x + day.width / 2, y: day.y + day.height / 2 };
      if (!item.contains(document.elementFromPoint(from.x, from.y))) throw new Error('Calendar drag source is obscured or outside the viewport');
      if (document.elementFromPoint(to.x, to.y)?.closest('.fc-daygrid-day')?.dataset.date !== '${dropDate}') throw new Error('Calendar drop target is obscured or outside the viewport');
      return { from, to }`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...eventDrag.from, buttons: 0 })
    await run(`window.__calendarPointer = [];
      window.__recordCalendarPointer = (event) => window.__calendarPointer.push({ type: event.type, x: event.clientX, y: event.clientY, buttons: event.buttons, target: event.target.closest('.fc-event')?.textContent ?? event.target.className });
      for (const type of ['mousedown', 'mousemove', 'mouseup']) document.addEventListener(type, window.__recordCalendarPointer, true)`)
    try {
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...eventDrag.from, button: 'left', buttons: 1, clickCount: 1 })
      assert.equal(await run<boolean>(`return window.__calendarPointer.some((event) => event.type === 'mousedown' && event.buttons === 1 && event.target.includes('Lunch with Sam at noon'))`), true,
        'The calendar must receive the pressed mouse button at the drag source')
      await delay(60)
      for (let step = 1; step <= 10; step++) {
        await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: eventDrag.from.x + (eventDrag.to.x - eventDrag.from.x) * step / 10,
          y: eventDrag.from.y + (eventDrag.to.y - eventDrag.from.y) * step / 10, button: 'left', buttons: 1 })
        await delay(20)
      }
      await delay(60)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...eventDrag.to, button: 'left', buttons: 0, clickCount: 1 })
      await until('the dragged calendar event to save', async () => (await app.evaluate<WorkspaceSnapshot>('window.serenity.refresh()')).events.some((item) => item.title === 'Lunch with Sam at noon' && item.start === dropDate))
    } catch (error) {
      const diagnostic = JSON.stringify({ expected: eventDrag, received: await run('return window.__calendarPointer') }, null, 2)
      console.error('Calendar drag diagnostics:', diagnostic)
      if (process.env.SERENITY_SMOKE_ARTIFACT_DIR) {
        await mkdir(process.env.SERENITY_SMOKE_ARTIFACT_DIR, { recursive: true })
        await writeFile(join(process.env.SERENITY_SMOKE_ARTIFACT_DIR, 'calendar-drag.json'), diagnostic)
      }
      throw error
    } finally {
      await run(`for (const type of ['mousedown', 'mousemove', 'mouseup']) document.removeEventListener(type, window.__recordCalendarPointer, true); delete window.__recordCalendarPointer; delete window.__calendarPointer`)
    }
  }
  await shot('serenity-calendar')
  const agenda = await run(`click(byText('.task-view-toggle button', 'Agenda')); await waitFor(() => $('.calendar-agenda'));
    return $$('.calendar-agenda button').map((item) => item.textContent).join(' | ')`)
  assert.match(String(agenda), /Lunch with Sam/)
  await run(`click($$('.calendar-agenda button').find((item) => item.textContent.includes('Lunch with Sam at noon'))); await waitFor(() => $('.calendar-event-dialog'));
    click(byText('.calendar-event-dialog button', 'Move to Trash')); await waitFor(() => $('.calendar-archive summary')?.textContent.includes('Trash (1)'))`)
  const trashedEvent = (await app.evaluate<WorkspaceSnapshot>('window.serenity.refresh()')).archivedEvents.find((item) => item.title === 'Lunch with Sam at noon')
  assert.ok(trashedEvent)
  assert.ok((await stat(join(workspace, 'trash', 'calendar', `${trashedEvent.id}.yaml`))).isFile(), 'Deleted event is in workspace Trash')
  await run(`$('.calendar-archive').open = true; click(byText('.calendar-archive button', 'Restore')); await waitFor(() => $$('.calendar-agenda button').some((item) => item.textContent.includes('Lunch with Sam at noon')))`)

  // Review: an AI-suggested entity can be created after review.
  const reviewed = await run(`click($('.ribbon-btn[aria-label^="Review"]')); await waitFor(() => $$('.review-card').length);
    click(byText('.review-card button', 'Create entity')); await sleep(200); await showSidebar(); return Boolean(await waitFor(() => $$('.tree-row').some((row) => row.textContent === 'Alex')))`)
  assert.equal(reviewed, true)

  // Settings is a dialog: shortcuts, appearance, and module switches.
  const settings = await run<{ rows: number; light: boolean; calendarHidden: boolean; calendarBack: boolean; scrollbarToggle: boolean }>(`click($('.ribbon-btn[aria-label="Settings"]')); await waitFor(() => $('.settings-dialog'));
    click(byText('.settings-nav button', 'Shortcuts')); await waitFor(() => $$('.settings-shortcuts tr').length); const rows = $$('.settings-shortcuts tbody tr').length;
    click(byText('.settings-nav button', 'Editor')); await sleep(50); click($('.switch[aria-label="Hide scrollbars"]'));
    const visible = Boolean(await waitFor(() => document.documentElement.dataset.scrollbars === 'always' && getComputedStyle($('.pane-body'), '::-webkit-scrollbar').width === '10px'));
    click($('.switch[aria-label="Hide scrollbars"]')); const scrollbarToggle = visible && Boolean(await waitFor(() => document.documentElement.dataset.scrollbars === 'auto'));
    click(byText('.settings-nav button', 'General')); await sleep(50); click(byText('.settings-dialog .segmented button', 'Light')); await sleep(100);
    const light = document.documentElement.dataset.theme === 'light';
    click(byText('.settings-nav button', 'Modules')); await sleep(50); click($('.switch[aria-label="Calendar"]'));
    const calendarHidden = Boolean(await waitFor(() => !$$('.ribbon-btn').some((item) => item.getAttribute('aria-label') === 'Calendar')));
    click($('.switch[aria-label="Calendar"]')); const calendarBack = Boolean(await waitFor(() => $$('.ribbon-btn').some((item) => item.getAttribute('aria-label') === 'Calendar')));
    click(byText('.settings-nav button', 'General')); await sleep(50); click(byText('.settings-dialog .segmented button', 'Dark')); click($('.dialog-close'));
    return { rows, light, calendarHidden, calendarBack, scrollbarToggle }`)
  assert.ok(settings.rows > 10, 'Settings lists every command with its shortcut')
  assert.deepEqual({ ...settings, rows: true }, { rows: true, light: true, calendarHidden: true, calendarBack: true, scrollbarToggle: true })

  // Chat mode, and conversation settings for a read scope limited to chosen knowledge.
  if (await run<boolean>(`return $('.app').classList.contains('narrow')`)) await key('j', mod | 8)
  else await run(`click($('.assistant-panel [aria-label="Open this chat full window"]'))`)
  const chat = await run<{ composer: boolean; scope: string; suggestions: string }>(`await waitFor(() => $('.chat-main .composer'));
    click($('.chat-main .composer button[aria-label^="Read scope"]')); await waitFor(() => $('[role="radiogroup"][aria-label="AI read scope"]'));
    click(byText('[role="radio"]', 'Selected knowledge')); await sleep(80); const scope = $('.chat-main .composer button[aria-label^="Read scope"]').textContent;
    click(byText('[role="radio"]', 'Whole workspace')); click(byText('.dialog button', 'Done') ?? byText('.dialog button', 'Save')); await sleep(80);
    await showSidebar(); if (!byText('.conversation-select', 'Robotics club notes')) throw new Error('Conversations listed: ' + $$('.conversation-row').map((row) => row.textContent).join(', ') + ' | sidebar: ' + $('.app').className);
    click(byText('.conversation-select', 'Robotics club notes')); await waitFor(() => $('.chat-suggestions'));
    const suggestions = $('.chat-suggestions').textContent;
    const composer = Boolean($('.chat-main textarea[aria-label="Message"]')); click($('.chat-header [aria-label="Return chat to sidebar"]')); await waitFor(() => $('.pane'));
    return { composer, scope, suggestions }`)
  assert.equal(chat.composer, true)
  assert.match(chat.suggestions, /1 decided suggestion/, 'A conversation shows the changes it suggested')
  assert.match(chat.scope, /selected/)
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
    ['Entity', `await showSidebar(); click(byText('.tree-row', 'Sam Rivera'))`], ['Timeline', `click(byText('.presentation-switcher button', 'Timeline'))`],
    ['New tab', `click($('.pane.focused .new-tab') ?? $('.new-tab'))`], ['Settings', `click($('.ribbon-btn[aria-label="Settings"]'))`],
    ['Chat', `click($('.dialog-close')); if ($('.assistant-panel [aria-label="Open this chat full window"]')) click($('.assistant-panel [aria-label="Open this chat full window"]')); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', code: 'KeyJ', shiftKey: true, metaKey: navigator.platform.includes('Mac'), ctrlKey: !navigator.platform.includes('Mac'), bubbles: true }))`]
  ]
  const accessibility: string[] = []
  for (const theme of ['dark', 'light']) {
    await run(`if ($('.dialog-close')) click($('.dialog-close')); if ($('.chat-header [aria-label="Return chat to sidebar"]')) click($('.chat-header [aria-label="Return chat to sidebar"]')); await sleep(150);
      click($('.ribbon-btn[aria-label="Settings"]')); await waitFor(() => $('.settings-dialog'));
      click(byText('.settings-nav button', 'General')); click(byText('.settings-dialog .segmented button', '${theme === 'dark' ? 'Dark' : 'Light'}'));
      await waitFor(() => document.documentElement.dataset.theme === '${theme}'); click($('.dialog-close')); await sleep(150)`)
    for (const [view, setup] of views) {
      const found = await run<string[]>(`${setup}; await sleep(400);
        await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
        const result = await axe.run(document, { resultTypes: ['violations'] });
        return result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => {
          const target = document.querySelector(item.nodes[0].target.join(' '));
          const root = getComputedStyle(document.documentElement);
          return item.id + ' (' + item.nodes.length + ') at ' + item.nodes[0].target.join(' ') + ': ' + (item.nodes[0].failureSummary ?? '').replace(/\\s+/g, ' ').slice(0, 280) +
            ' [theme=' + document.documentElement.dataset.theme + ', rootText=' + root.getPropertyValue('--text').trim() + ', rootBg=' + root.getPropertyValue('--chrome').trim() +
            ', targetColor=' + (target && getComputedStyle(target).color) + ', parentColor=' + (target?.parentElement && getComputedStyle(target.parentElement).color) + ']';
        })`)
      accessibility.push(...found.map((item) => `${theme} ${view}: ${item}`))
    }
  }
  assert.deepEqual(accessibility, [], 'Main views should have no serious or critical accessibility violations')

  await run(`await showSidebar(); click($('[aria-label="Star Robotics club notes"]'));
    await waitFor(() => $('.conversation-list .sidebar-heading')?.textContent === 'Starred');
    const row = byText('.conversation-select', 'Robotics club notes'); const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 5 }));
    await waitFor(() => $('.menu.context')); window.confirm = () => true; click(byText('.menu.context .menu-item', 'Delete chat'));
    await waitFor(() => !byText('.conversation-select', 'Robotics club notes'))`)
  assert.equal((await app.evaluate<WorkspaceSnapshot>('window.serenity.refresh()')).proposals.filter((item) => item.conversationId === '123e4567-e89b-42d3-a456-426614174093').length, 0)

  // Crash the renderer on purpose: the window should reload itself with a working bridge and the same workspace.
  await app.send('Page.crash').catch(() => undefined)
  let recovered: unknown = null
  for (let attempt = 0; attempt < 60 && !recovered; attempt++) {
    await delay(250)
    recovered = await app.evaluate('window.serenity?.refresh().then((snapshot) => snapshot?.path) ?? null', 3000).catch(() => null)
  }
  assert.equal(recovered, workspace, 'A crashed window should reload into the same workspace')
  console.log('Desktop smoke passed: workspace files, live-preview editing, panes, search (PDF/DOCX), tasks, calendar, review, settings, chat, accessibility, and crash recovery.')
} catch (error) {
  const diagnostics = process.env.SERENITY_SMOKE_ARTIFACT_DIR
  if (diagnostics) {
    await mkdir(diagnostics, { recursive: true })
    await writeFile(join(diagnostics, 'failure.txt'), `${String(error)}\n${app.logs()}`)
    await app.screenshot().then((bytes) => writeFile(join(diagnostics, 'failure.png'), bytes)).catch(() => undefined)
    const state = await run(`return { theme: document.documentElement.dataset.theme, viewport: [innerWidth, innerHeight],
      window: [outerWidth, outerHeight], screen: [screen.width, screen.height], devicePixelRatio,
      focused: document.activeElement?.outerHTML, app: $('.app')?.className, body: document.body.innerText }`).catch(String)
    await writeFile(join(diagnostics, 'state.json'), JSON.stringify(state, null, 2))
  }
  throw error
} finally {
  await app.close()
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
