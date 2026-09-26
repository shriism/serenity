# Serenity

Serenity is a cross-platform Electron application for building a personal knowledge workspace with AI assistance. Product principles and agreed decisions are in [SERENITY.md](SERENITY.md); implementation boundaries and module extension guidance are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

Install Node.js 24 or newer, then:

```sh
npm install
npm run dev
```

Choose an existing directory or create one when the application opens. You can also explicitly supply one at startup with `--workspace=/path/to/directory`. Serenity writes `pages/`, `entities/`, `claims/`, `conversations/`, `proposals/`, `documents/`, `calendar/`, `tasks/`, `activity/`, and `archive/` there. The rebuildable SQLite full-text index is in `.serenity/index.sqlite`; module settings are in `.serenity/modules.yaml`, while `.serenity/session.yaml` remembers this workspace's last open resources and view. Files imported from elsewhere are **copied** into `documents/`. Linked files and linked workspace directories are not treated as part of the workspace; import a copy instead.

The selected directory is the knowledge source of truth. Provider credentials are saved outside it using operating-system secure storage when available; otherwise an entered credential is held only for the current app session. The Activity view lists provider requests with record references and prompt checksums, without storing an additional copy of the prompt. You can edit the Markdown and YAML files in a text editor; Serenity refreshes when files change, preserves custom YAML fields and comments during app edits, and refuses to overwrite an entity, calendar event, task, or conversation modified since you began editing it.

Use **Open workspace folder** in the sidebar to inspect or back up your files. Unsaved entity and page edits prompt before you switch workspaces or close the window.

The desktop UI is one workbench with a compact navigation dock and a contextual AI assistant. The dock reveals its labels without shifting the open work area; the assistant can collapse or expand over the center. Home is `pages/Home.md`: edit it in Serenity or another text editor. Its Markdown can contain prose, stable `serenity:` links, and bounded `serenity-query` fenced YAML blocks. For example, `from: upcoming` with `limit: 6` shows tasks and events backed by files in this workspace; other sources include `entities`, `claims`, `documents`, `tasks`, `events`, `proposals`, and `pages`. The built-in template is yours to replace. Create additional pages from **New page** in the workspace actions menu or command palette. `.serenity/workbench.yaml` chooses the Home page and the navigation groups and command order; editing it updates the UI. Entities, supported documents, and pages other than Home open in tabs. **Split editor** in the top bar (⌘\\ or Ctrl+\\) places a second editor group beside the first, each with its own tabs and view, so you can keep a document next to the entity or page you are building from it. ⌘/Ctrl-click a page link or press ⌘/Ctrl+Enter in search to open a result to the side; the layout is restored with the workspace. An open entity can be viewed as its **Profile** (the editable narrative and claims), its **Timeline** (when each claim was recorded, corrected, chosen as current, merged, or proposed by AI, plus linked events and tasks, with sources), or its **Connections** (confirmed relationships in both directions and shared events and tasks). Each tab remembers its view, so Alex's profile can sit beside Alex's timeline. Review also lists **possible duplicates** among existing entities with the evidence for each (similar names, the same type, identical facts or relationships); compare the two side by side, keep one with a reversible merge, or leave them. A merge you undo counts as a judgment that they differ and is not suggested again. Review groups AI suggestions by their source; for an imported document, **Review beside document** opens it to the side, and a document's own view lists the suggestions drawn from it next to its text, so each can be checked against the evidence before you accept it. The assistant is told which permitted resources are shown side by side; the assistant sees which file or page is active and prioritizes permitted open content for relevant questions. Its conversation inspector shows which records were actually sent. Answers list the records they rely on as numbered sources you can open (⌘/Ctrl-click to open beside your work); a source the assistant was never given, or a quote that does not appear in the cited record, is flagged as unverified. Search and workspace actions are in the compact top bar. Use **⌘K**, **⌘B**, and **⌘J** on macOS (or **Ctrl+K**, **Ctrl+B**, and **Ctrl+J** on Windows/Linux) to search, toggle the dock, and toggle the assistant. To change shortcuts for a workspace, add a `keybindings` map to `.serenity/workbench.yaml` from command ID to chord (`Mod` is ⌘ on macOS and Ctrl elsewhere), or to `null` to remove a default:

```yaml
keybindings:
  entity.create: Mod+Shift+E
  page.open.research: Mod+Alt+R
  assistant.toggle: null
```

Chords need Mod, Ctrl, or Alt unless they are function keys. Unknown commands and conflicting chords appear as workspace warnings instead of being silently ignored. The app starts in Dark appearance, with Light and System options in the navigation dock.

To check the project:

```sh
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

The desktop smoke test launches Electron and exercises workspace files, IPC, search (including PDF/DOCX), tasks, and calendar; run it on a machine with a graphical desktop. It runs Serenity with `--background`, a hidden window that does not take focus, and a temporary browser profile, so you can keep working and your own settings are untouched; set `SERENITY_SMOKE_VISIBLE=1` to watch it. Live provider runs (below) use your normal profile, where provider credentials are stored. Set `SERENITY_SMOKE_PROVIDER=copilot` or `codex` to also test a live conversation against your configured provider. Set `SERENITY_SMOKE_EXECUTABLE` to the path of a packaged app executable to test the installed build instead of development Electron.

To package for the current OS use `npm run dist`. Platform-specific commands are `npm run dist:mac`, `npm run dist:win`, and `npm run dist:linux` (cross-building may require platform-specific tooling or a machine running the target OS). Packaging generates the platform icons from `assets/icon.svg`. Unsigned macOS builds may require manual permission to open.

## AI connections

The conversation view can switch between GitHub Copilot and OpenAI Codex. Connect a supported provider account using its native tooling, or enter a credential under **Connections**. The SDKs use provider-backed services; no local model is required. In-flight conversations can be cancelled. Each conversation's workflow can ask first, review proposals, or auto-save permitted proposal types. Autonomous workflows initially auto-save only sourced claims; entity, task, and event permissions can be granted individually. AI can read the whole chosen workspace by default; a conversation can instead opt into selected entities/documents and separately allow other conversations or calendar/tasks. The current conversation is always part of its own request. Workspace-level background AI modules have separate switches. Provider agent tools are disabled or set read-only: knowledge updates are made through Serenity's own reviewed or user-authorized workflow.

The desktop app also lets you read and edit Markdown entities, link them through sourced claims, archive and reversibly merge duplicates without losing history, search text and relationships, ask a provider to search semantically on demand, import source files, analyze text/PDF/DOCX documents through conversation, review AI suggestions for claims, entities, tasks, and events, and control whether conversations are retained. Retracted claims stay in history but are excluded from current search. You can mark one competing claim as the current answer and undo that decision without erasing the original sources. Its internal calendar and task modules connect records to existing entities, support multiple links per item, and let you archive or restore events and tasks without destroying their files. Modules can be disabled without deleting data. An optional background AI indexing module builds derived semantic summaries and topic terms under `.serenity/semantic-index.yaml`; those terms can be searched locally using sparse vector similarity without another provider call. An independent opt-in document analysis module analyzes newly added or changed documents and drafts proposals. Both send workspace content to the selected provider when enabled, so both are off by default.

When an AI-suggested entity resembles one you already have, Review offers **Attach to selected entity** or **Create separate entity**. Attaching records the proposed narrative as a sourced context claim; it does not overwrite the existing Markdown narrative.

Documents with supported text formats (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.pdf`, `.docx`) can be searched and analyzed. Other imported files remain in the workspace, but the Documents view identifies them as not text-extractable rather than offering analysis without content. All imported files can be opened in their native application; sourced claims and proposals link to a document when their source matches its filename.

Background semantic indexing processes long records in chunks. On-demand semantic search uses a visible catalog and relevant excerpts when a workspace is larger than one provider request.

## Desktop scope

The agreed desktop app supports the installed local workspace, Copilot and Codex integrations, human-reviewed and permission-bounded AI updates, connected knowledge, internal calendar and tasks, document analysis, and hybrid retrieval. It has passed packaged-app smoke tests on macOS, Windows, and Linux; live Copilot and Codex conversations have been tested from the packaged macOS app. Provider sign-in is needed for live use on each device.

Search combines on-device text indexing, locally ranked AI-generated topic terms, and optional on-demand provider retrieval rather than neural embeddings. Identity matches are suggested for human review rather than merged without confirmation. External calendar sync is not part of the internal calendar. Cloud sync, local models, and mobile interaction remain separate future goals.
