# Serenity

Serenity is a desktop workspace for notes, documents, connected knowledge, plans, and AI conversations. Choose a folder for your data; Serenity keeps your authored knowledge in readable Markdown and YAML files. Its assistant can find evidence and suggest changes, while you control what it reads and saves.

[Download the latest release](https://github.com/shriism/serenity/releases/latest) · [Product principles](SERENITY.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Project status](CONTEXT.md)

## Install

Download the macOS Apple silicon DMG or ZIP, Windows x64 installer, or Linux x64 AppImage from the release page. The assets include `SHA256SUMS`. Builds are unsigned; macOS may ask you to approve the app on first launch. Provider sign-in is required for AI features, but local files and search work without it.

On first launch, choose an existing folder or create a workspace. You can also launch with `--workspace=/path/to/folder`. Serenity remembers recently opened folders and offers to reopen the last one. Use the workspace menu at the foot of the left sidebar to change folders.

## Work in Serenity

The left ribbon opens Home, Knowledge, Review, Documents, Calendar, Tasks, and Activity. The explorer lists pages, entities, and imported documents. Open any resource in a tab; split panes horizontally or vertically, resize them, and drag tabs between them. Serenity restores the layout and each tab's view when you reopen the workspace. In a narrow window, panes switch one at a time and sidebars float over the content.

Pages and entity notes use a live-preview Markdown editor. Type `[[` to link to a page, entity, or document; links with ambiguous names are flagged rather than guessed. Changes save as you work. If another program changes a file during editing, Serenity asks which version to keep. Right-click a page, entity, or document to move it to the archive without deleting its files.

Entities have stable IDs and sourced claims. Their Profile, Timeline, and Connections views show what is known, where it came from, and how it changed. Review lets you compare suggested knowledge with its source, resolve possible duplicate identities, and keep competing claims visible. A merge can be undone; marking two entities as distinct is also reversible.

Import documents as copies into `documents/`. Text, Markdown, CSV, JSON, YAML, PDF, and DOCX can be searched; unsupported formats remain in the workspace and open in their native app. Documents can show extracted text, a Markdown outline where headings exist, and knowledge attributed to the document. Calendar and Tasks are internal, optional modules. Disabling either hides its view and stops its writes while keeping its files.

Search uses a local, rebuildable full-text index. From search, **Keep results in a pane** preserves a result set beside the file you open. Pages can include bounded `serenity-query` blocks for live lists, tables, or counts. For example:

````markdown
```serenity-query
from: tasks
where:
  status: open
limit: 10
```
````

Queries read this workspace only; they cannot execute code. Navigation order, Home, and shortcut overrides live in `.serenity/workbench.yaml`.

## Assistant and chat

Choose GitHub Copilot or OpenAI Codex in the assistant. The right sidebar works alongside your panes; its expand control opens the conversation full-window, and the return control restores the sidebar. **New chat** sits beside **Chat history**. In full-window chat, the left sidebar lists conversations, which can be starred. The history menu contains earlier chats and the current chat's delete action.

The focused pane is the assistant's primary context. Other visible panes can add context within the conversation's read scope. A conversation can read the whole workspace or only selected entities and documents; separate permissions cover other conversations, calendar, and tasks. The inspector lists what was actually sent to the provider. Responses link to their sources and flag citations that cannot be verified against transmitted records.

A conversation can ask before acting, propose changes for review, or automatically save explicitly permitted kinds of changes. New autonomous workflows initially allow only sourced claims; entity, task, and event permissions are granted separately. New categories and ambiguous identities still require review. Suggested records appear beneath the answer and in Review with **Accept** and **Dismiss**. Optional document analysis and semantic indexing can send workspace content to the selected provider and are off by default.

Conversations are retained in the workspace by default. You can opt out of retention for a conversation or delete one. Switching providers can continue the visible conversation, though provider-private session state does not transfer.

## Files and privacy

The chosen folder contains `pages/`, `entities/`, `claims/`, `resolutions/`, `identity-decisions/`, `conversations/`, `proposals/`, `documents/`, `calendar/`, `tasks/`, `activity/`, `archive/`, and `trash/` as needed. `.serenity/` holds workspace configuration, session state, and derived indexes. The Markdown and YAML records are the source of truth; the SQLite search index can be rebuilt. Imported files are copied. Symlinked workspace content is excluded. Provider credentials stay in OS-protected storage when available or in session memory, outside the workspace.

Activity records provider operations, referenced records, prompt size and checksum, and outcome; it does not save a second copy of the prompt. Back up or sync the workspace folder with a tool of your choice. Serenity does not yet provide its own cloud sync.

## Shortcuts

The application menu and Settings show available commands and their current shortcuts. Defaults include **⌘/Ctrl+K** for search, **⌘/Ctrl+B** for the left sidebar, **⌘/Ctrl+J** for the assistant, **⌘/Ctrl+Shift+J** for full-window chat, **⌘/Ctrl+T** for a new tab, **⌘/Ctrl+W** to close a tab, **⌘/Ctrl+N** for a page, **⌘/Ctrl+O** to find a workspace file, and **⌘/Ctrl+Shift+O** to open another workspace. Settings lets you change or clear shortcuts per workspace.

## Develop

Node.js 24 or newer is required.

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run smoke:desktop` exercises the installed app path with a temporary workspace and profile; `npm run perf:desktop` checks a large synthetic workspace. Both need a graphical desktop. `SERENITY_SMOKE_VISIBLE=1` displays the smoke-test window; `SERENITY_SMOKE_EXECUTABLE` selects a packaged executable. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` enables an authenticated live turn and uses provider quota. Unset `ELECTRON_RUN_AS_NODE` if your terminal exports it.

Run `npm run dist` to package for the current OS, or `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux` for a specific target when its tooling is available. CI typechecks, tests, packages, and smoke-tests macOS, Windows, and Linux builds. See [ARCHITECTURE.md](ARCHITECTURE.md) for process boundaries and [CONTEXT.md](CONTEXT.md) for planned work.
