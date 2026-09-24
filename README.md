# Serenity

Serenity is a cross-platform Electron application for building a personal knowledge workspace with AI assistance. Product principles and agreed decisions are in [SERENITY.md](SERENITY.md); implementation boundaries and module extension guidance are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

Install Node.js 24 or newer, then:

```sh
npm install
npm run dev
```

Choose an existing directory or create one when the application opens. You can also explicitly supply one at startup with `--workspace=/path/to/directory`. Serenity writes `entities/`, `claims/`, `conversations/`, `proposals/`, `documents/`, `calendar/`, `tasks/`, `activity/`, and `archive/` there. The rebuildable SQLite full-text index is in `.serenity/index.sqlite`; module settings are in `.serenity/modules.yaml`.

The selected directory is the knowledge source of truth. Provider credentials are saved outside it using operating-system secure storage when available; otherwise an entered credential is held only for the current app session. The Activity view lists provider requests with record references and prompt checksums, without storing an additional copy of the prompt. You can edit the Markdown and YAML files in a text editor; Serenity refreshes when files change, preserves custom YAML fields and comments during app edits, and refuses to overwrite an entity, calendar event, task, or conversation modified since you began editing it.

Use **Open workspace folder** in the sidebar to inspect or back up your files. Unsaved entity edits prompt before you switch workspaces or close the window.

The desktop UI has three panes: navigation on the left, open files and tools in the middle, and a persistent AI assistant on the right. Each sidebar collapses to an icon rail and reopens with its panel button. The assistant's expand button gives chat the middle pane too. Entity and supported document files open in tabs; the assistant sees which file is active and prioritizes permitted open files for relevant questions. Its conversation inspector shows which records were actually sent. Use **⌘K** on macOS or **Ctrl+K** on Windows/Linux to search, and choose System, Light, or Dark in the navigation sidebar's Appearance control.

To check the project:

```sh
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

The desktop smoke test launches Electron and exercises workspace files, IPC, search (including PDF/DOCX), tasks, and calendar; run it on a machine with a graphical desktop. Set `SERENITY_SMOKE_PROVIDER=copilot` or `codex` to also test a live conversation against your configured provider. Set `SERENITY_SMOKE_EXECUTABLE` to the path of a packaged app executable to test the installed build instead of development Electron.

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
