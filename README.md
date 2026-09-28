# Serenity

Serenity is a cross-platform desktop application for building a personal knowledge workspace with AI assistance. Your knowledge lives as ordinary Markdown and YAML files in a folder you choose; AI helps you find, connect, and propose changes, and you decide what is kept.

Product principles and agreed decisions are in [SERENITY.md](SERENITY.md), implementation boundaries in [ARCHITECTURE.md](ARCHITECTURE.md), user-visible changes in [CHANGELOG.md](CHANGELOG.md), and the current roadmap in [CONTEXT.md](CONTEXT.md).

## Install and run

Install Node.js 24 or newer, then:

```sh
npm install
npm run dev
```

Choose an existing directory or create one when the application opens, or supply one at startup with `--workspace=/path/to/directory`. To build an installable app for the current OS, run `npm run dist` (see [Development](#development)). Unsigned macOS builds may require manual permission to open.

## Your workspace

The chosen directory is the knowledge source of truth. Serenity writes `pages/`, `entities/`, `claims/`, `resolutions/`, `identity-decisions/`, `conversations/`, `proposals/`, `documents/`, `calendar/`, `tasks/`, `activity/`, and `archive/` there. `.serenity/` holds workspace settings and rebuildable data: the full-text index (`index.sqlite`), module switches (`modules.yaml`), navigation and shortcuts (`workbench.yaml`), and the last open panes and views (`session.yaml`).

- **Imports are copies.** Files imported from elsewhere are copied into `documents/`. Linked files and linked workspace directories are not treated as part of the workspace; import a copy instead.
- **Edit anywhere.** You can edit the Markdown and YAML in a text editor; Serenity refreshes when files change, keeps custom YAML fields and comments during app edits, and refuses to overwrite a record changed since you began editing it. Unsaved entity and page edits prompt before you switch workspaces or close the window.
- **Damage is preserved, not overwritten.** An unreadable session or settings file is kept beside a fresh one as `.corrupt-<id>`, and rebuildable indexes are rebuilt from your records.
- **Credentials stay outside.** Provider credentials are saved in the operating system's secure storage when available, or held only for the current session. The Activity view lists provider requests with record references and prompt checksums, without keeping another copy of the prompt.

Use the workspace menu at the bottom of the sidebar to reveal the folder, back it up, or open another workspace.

## The workbench

Serenity looks and behaves like a native desktop app. Tabs sit in the title bar beside the window controls. On the left are a ribbon of views and a file tree of your workspace. The assistant lives in a sidebar on the right. A switch at the top left moves between two modes:

- **Workspace** is for reading and editing. The ribbon opens Home, Knowledge, Review, Documents, Calendar, Tasks, and Activity, with Settings at the bottom. The explorer lists your pages, your entities grouped by type, and your documents. Click an item to open it, or **⌘/Ctrl-click** to open it in the next pane.
- **Chat** is a full-window conversation, in the style of the ChatGPT and Claude apps, with your conversations listed on the left.

It starts in Dark appearance; Light and Match system are in Settings (**⌘,** / **Ctrl+,**). The app menu lists every action with its shortcut. Common ones:

- **⌘K**: search
- **⌘B**: toggle the sidebar
- **⌘J**: toggle the assistant
- **⌘⇧J**: switch between Workspace and Chat
- **⌘T**: new tab
- **⌘W**: close tab
- **⌘N**: new page
- **⌘O**: open another workspace

Elsewhere, use **Ctrl** in place of **⌘**.

### Panes and tabs

Everything opens as a tab: pages, entities, documents, and views such as Calendar or Search. An empty tab offers quick ways to fill it. The center works like Obsidian's panes:

- Split any pane right (**⌘\\** / **Ctrl+\\**) or down (**⌘⇧\\** / **Ctrl+Shift+\\**) from its **⋯** menu.
- Resize by dragging a divider, or focus it and use the arrow keys; double-click to even it out.
- Drag a tab onto another pane to move it, onto a pane's edge to split it off, or onto another tab to reorder. Middle-click closes a tab.
- Move between panes with **⌘⌥** / **Ctrl+Alt** and the arrow keys, and between tabs with **⌘⇧[** and **⌘⇧]**.
- **Search in a pane** (**⌘⇧F** / **Ctrl+Shift+F**, or **Keep results in a pane** from search) keeps results open; each opens in the neighboring pane.

Closing a pane only closes its tabs; files stay in your workspace. The arrangement, sizes, and each tab's view are restored with the workspace. When the window is too narrow for every pane, Serenity shows one pane at a time with a switcher, and the sidebars float over the content.

### Views of a resource

A bar under the tabs shows where a file lives (for example *Knowledge › person › Alex*) and, where there is a choice, how to view it:

- **Entity:** **Profile**, **Timeline**, or **Connections**.
  - Profile shows the name, type, notes, and sourced facts.
  - Timeline shows when each fact was recorded, corrected, chosen as current, merged, or suggested by AI, plus linked events and tasks. It can be filtered by kind.
  - Connections shows confirmed relationships both ways, shared events and tasks, and the pages and notes that mention the entity.
- **Document:** **Text**, with an outline for Markdown documents that have headings, or **Knowledge from it**.
  - Knowledge from it lists the facts, entities, and plans that name the document as their source, including retracted claims.
  - **Suggest connections between these** asks the assistant for sourced relationships among those entities.
- **Page:** **Page** or **Links**. Links shows resolved links, names that need disambiguation or have no match, and incoming wikilink mentions.
- **Tasks:** a list, or a board grouped by due date.
- **Calendar:** a month grid, or an agenda of the month's events and open tasks.

### Writing

Pages and entity notes open ready to edit in a live-preview Markdown editor. Headings, emphasis, lists, quotes, links, and `[[wikilinks]]` show formatted, and their Markdown appears only on the line you are editing.

- Click a link to follow it; **⌘/Ctrl-click** opens it in the next pane.
- Task checkboxes (`- [ ]`) can be ticked in place. **⌘B** and **⌘I** toggle bold and italic.
- Typing `[[` suggests page, entity, and document names.
- Titles are edited in place above the text.

There is no Save button: edits are saved as you pause, when you leave the editor, and when you close its tab. If the file changed on disk while you were typing, Serenity asks whether to keep your version or the one on disk rather than overwriting either.

### Pages, links, and live lists

Home is `pages/Home.md`; the built-in template is yours to replace, and **New page** (**⌘N**) creates more. Page Markdown can contain:

- **Wikilinks**, as in Obsidian: `[[Alex]]` or `[[Alex|my friend]]` link a page, entity, or document by its exact title. A name shared by several things, or by nothing yet, is marked instead of guessed. Entity narratives support them too, typing `[[` suggests titles, and renaming an entity offers to update the links that named it.
- Stable `serenity:` links to resources and `serenity:command/…` links to commands.
- Web and email links, opened in your browser or mail app.
- Bounded `serenity-query` blocks, fenced YAML that lists records from this workspace. They show as live lists; hover one and choose **Edit** to change its YAML:

````markdown
```serenity-query
from: claims
where:
  source: syllabus.pdf
limit: 10
```
````

Add `display: table` for a two-column table or `display: count` for just the number of matches (for example, pending proposals). Sources are `upcoming`, `entities`, `claims`, `documents`, `tasks`, `events`, `proposals`, `pages`, and `activity` (recent changes, filterable by `kind`). A `source` filter selects records recorded from a document, optionally followed by a location such as `, p. 2`. Queries cannot run code or read outside the workspace.

`.serenity/workbench.yaml` chooses the Home page and which views appear in the ribbon, in order; editing it updates the window.

### Knowledge library and Activity

The Knowledge library filters by name and type and can be shown as **Tiles** or as a **Graph** of entities linked by confirmed relationships and wikilinks (the 150 most connected matches; hover to highlight a neighborhood). Activity lists changes grouped by day, filterable by text and kind, each opening the record it concerns.

## Review and identity

Review groups AI suggestions by their source. For an imported document, **Review beside document** opens it to the side, and the document's own view lists its suggestions next to its text, so each can be checked against the evidence before you accept it. When an AI-suggested entity resembles one you have, **Attach to selected entity** records the proposal as a sourced context claim without overwriting your narrative; **Create separate entity** keeps them apart.

Review also lists **possible duplicates** among existing entities with the evidence for each (similar names, the same type, identical facts or relationships). Compare the two side by side, keep one with a reversible merge, or **Mark as distinct**. A distinct decision is a versioned YAML record under `identity-decisions/`: it removes the pair from suggestions and prevents merging them while active, and **Undo decision** brings the suggestion back. An undone merge also counts as a judgment that the two differ.

Claims keep their sources. Retracted claims stay in history but leave current search, and you can mark one competing claim as the current answer and undo that decision without erasing the original sources.

## The assistant

The assistant can use GitHub Copilot or OpenAI Codex. Connect an account with the provider's native tooling or enter a credential under **AI providers** in Settings; no local model is required. Under the message field, choose the provider, what the assistant may change, and what it may read; **Enter** sends, **Shift+Enter** adds a line, and the stop button cancels a request. Open a conversation full-window with Chat mode.

- **What it sees.** The focused pane's resource is its primary context and other visible panes add context; chips above the message field show what it can see. By default it may read the whole workspace; a conversation can instead allow only selected entities and documents (chosen with a searchable picker) and separately allow other conversations or calendar and tasks. The current conversation is always included. The conversation inspector shows which records were actually sent. From search, **Ask about these results** starts a conversation that may read only the entities and documents the search found.
- **Sources.** Answers list the records they rely on as numbered sources you can open. A source the assistant was never given, or a quote that does not appear in the cited record, is flagged as unverified.
- **What it may change.** Each conversation can ask first, propose changes for review, or auto-save permitted proposal types. Autonomous workflows initially auto-save only sourced claims; entity, task, and event permissions can be granted individually. Provider tools are disabled or read-only: changes go through Serenity's own reviewed workflow.
- **Background AI.** An optional indexing module builds summaries and topic terms under `.serenity/semantic-index.yaml` that can be searched locally without another provider call, and an optional document analysis module drafts proposals for new or changed documents. Both send workspace content to the selected provider, so both are off by default.

## Documents

Text formats (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.pdf`, `.docx`) can be searched and analyzed. Other imported files stay in the workspace and open in their native application; the Documents view marks them as not text-extractable. Sourced claims and proposals link to a document when their source names it.

Search combines on-device full-text indexing (titles weigh most, records matching every word come first, and each result shows where it matched), locally ranked AI topic terms, and optional on-demand provider retrieval. The index is rebuilt in the background when files change. PDF and DOCX text is extracted in a background worker, so a large document does not hold up editing. Large workspaces are handled with a visible catalog and relevant excerpts rather than neural embeddings.

## Shortcuts and customization

Settings lists every command with its current shortcut and ID. Appearance, **Switch view of this tab**, and the tab and pane actions are commands too, so they can be searched for and bound to keys. To change shortcuts for a workspace, add a `keybindings` map to `.serenity/workbench.yaml` from command ID to chord (`Mod` is ⌘ on macOS and Ctrl elsewhere), or `null` to remove a default:

```yaml
keybindings:
  entity.create: Mod+Shift+E
  page.open.research: Mod+Alt+R
  assistant.toggle: null
```

Chords need Mod, Ctrl, or Alt unless they are function keys. Unknown commands and conflicting chords appear as workspace warnings instead of being silently ignored. Modules such as Calendar and Tasks can be turned off in Settings without deleting their files.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

The desktop smoke test launches Electron against a temporary workspace and exercises files, IPC, live-preview editing and autosave, wikilinks, panes, search (including PDF/DOCX), tasks, calendar, review, Settings, Chat mode, session restore, recovery from a crashed window, and an axe-core accessibility check of every main view in both themes. It needs a graphical desktop, runs Serenity with `--background` (a hidden window that never takes focus) and a temporary browser profile so your own settings are untouched, and shows the window with `SERENITY_SMOKE_VISIBLE=1`. Set `SERENITY_SMOKE_PROVIDER=copilot` or `codex` to also test a live conversation (this uses your normal profile, where credentials are stored), and `SERENITY_SMOKE_EXECUTABLE` to test a packaged executable. If your shell sets `ELECTRON_RUN_AS_NODE=1`, unset it first.

`npm run perf:desktop` times the app on a large synthetic workspace (2,000 entities, 8,000 claims) and fails if launch, navigation, typing, or search exceed their budgets. After `npm run build`, `npx tsx tests/ui-screens.ts [directory]` saves screenshots of the main screens on a sample workspace for visual review.

To package for the current OS use `npm run dist`; `npm run dist:mac`, `npm run dist:win`, and `npm run dist:linux` target one platform (cross-building may need that platform's tooling). Packaging generates icons from `assets/icon.svg`. CI typechecks, tests, packages, and smoke-tests the packaged app on macOS, Windows, and Linux.

## Scope

This release covers the local desktop workspace, Copilot and Codex, human-reviewed and permission-bounded AI updates, connected knowledge, internal calendar and tasks, document analysis, and hybrid retrieval. Serenity 2.0.0 is the current release; installers for each platform are attached to its GitHub release with a `SHA256SUMS` file. Packaged builds pass smoke tests on macOS, Windows, and Linux, and live Copilot and Codex conversations have been tested from the packaged macOS app; provider sign-in is needed on each device. External calendar sync, cloud sync, local models, mobile access, and installable plugins are future goals.
