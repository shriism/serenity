# Serenity architecture

This describes how Serenity 2.0 is built: the process boundaries, what lives on disk, how the workbench composes views, and how AI stays inside Serenity's review and permission rules. Product decisions are in [SERENITY.md](SERENITY.md); the roadmap and status are in [CONTEXT.md](CONTEXT.md).

## Runtime boundaries and security

- **Renderer (`src/renderer/`)** presents the workspace with React. It runs sandboxed with context isolation, has no Node.js or filesystem access, and never sees provider credentials.
- **Preload (`src/preload/`)** exposes a small, typed API through Electron's context bridge. Every persistent change is an IPC request the main process validates.
- **Main process (`src/main/`)** owns the workspace: it chooses and watches the directory, reads and validates files, performs revision-checked writes, maintains the search index, extracts document text, and runs the AI SDKs.
- **Shared (`src/shared/`)** holds the pure logic used on both sides: record types (`types.ts`), resources, layout, queries, wikilinks, keybindings, search ranking, provenance, entity history, duplicate detection, citations, the module registry, and the document-analysis prompt. It has no Electron or Node dependencies, which keeps it testable and reusable for a future mobile client.

The window cannot navigate or open new windows (`will-navigate` is prevented and `setWindowOpenHandler` denies), permission requests are refused, and the renderer's Content-Security-Policy allows only the app's own scripts. Web and email links from Markdown are opened by the main process after `src/shared/external-links.ts` accepts them; only `http`, `https`, and `mailto` are allowed. Only the current workspace path can be revealed in the OS file manager; the renderer cannot pass arbitrary paths. Provider credentials live in OS-protected storage (`src/main/credentials.ts`) or in memory for the session, never in the workspace. Recently opened workspaces are listed in the app's settings folder (`src/main/recent-workspaces.ts`); the renderer can reopen a workspace only by naming a path already on that list, which only the folder picker or a launch argument adds to.

## Workspace on disk

The chosen directory is the source of truth; everything else is rebuildable.

| Location | Contents |
| --- | --- |
| `pages/` | Markdown pages with YAML frontmatter, including `Home.md` (seeded only if missing) |
| `entities/` | Markdown entity files with YAML frontmatter and a narrative |
| `claims/` | YAML sourced claims: subject, content, source, status (confirmed, proposed, retracted) |
| `resolutions/` | Append-only current-answer choices among competing claims |
| `identity-decisions/` | Versioned records that two entities are distinct |
| `conversations/`, `proposals/` | Retained conversations and reviewable AI proposals |
| `documents/` | Imported copies of source files |
| `calendar/`, `tasks/` | Records of the optional internal modules |
| `activity/` | Provider-request records (operation, provider, referenced IDs, prompt size and checksum, outcome) |
| `archive/` | Merged entities and their redirects, merge history, archived tasks, events, pages, and documents, and entities removed on purpose with their facts (`archive/removed/`) |
| `.serenity/` | `modules.yaml`, `workbench.yaml`, `session.yaml`, `semantic-provider.yaml`, and derived `index.sqlite` and `semantic-index.yaml` |

Record IDs are stable UUIDs, so renaming or retyping an entity breaks nothing. Types and relationship names are user-chosen strings, not a fixed ontology. Claims keep confirmations, conflicts, and retractions distinct; a correction is recorded as a resolution rather than by rewriting the original claims. Edits to a known field update YAML nodes in place, preserving unknown fields and comments.

Imports are copied into `documents/`; the original path is never stored as the location. Workspace directories must be real directories, and symlinked record, document, or page files are not read as workspace content.

**Merges and identity.** A merge moves the duplicate's Markdown to `archive/entities/` and records a redirect under `archive/merges/`; its claims stay in their files and resolve through the redirect on read. Undoing a merge restores the entity and records the reversal under `archive/merges/history/`. A distinct-identity decision stores a canonical ordered pair; active decisions follow merge redirects, hide the pair from duplicate suggestions, and block merging it. Undo writes `undoneAt` into the same record. `src/shared/deduplicate.ts` finds candidates with their evidence (similar names, same type, identical facts or relationships).

**Damage recovery.** Invalid externally edited files are reported as workspace errors, not dropped. A damaged `session.yaml`, settings file, semantic index, or document-analysis state is moved to a `.corrupt-<id>` sibling and replaced with a fresh start; a damaged `index.sqlite` is set aside and rebuilt. Filesystem permission errors still surface rather than being mistaken for corruption.

## Reading and writing

**Snapshots.** The renderer works from a `WorkspaceSnapshot` of the whole workspace. Reading reuses each file's text and parse while its size, modification and change times, and inode are unchanged; cached records are cloned on the way out because snapshot assembly adjusts them (for example, resolving merges), and entries for deleted files are swept. Files are still checked to be regular files inside the workspace on every read. A 2,000-entity, 8,000-claim workspace refreshes in about 140 ms. Each snapshot carries a `generation` that increases in the order reading began, and the renderer ignores one older than what it has, so a slow refresh never replaces the result of a newer operation.

**Writes.** Saves carry the revision the editor started from and fail if the file changed on disk since, so an external edit is never silently overwritten. Writes to one file are serialized within the running workspace and use atomic temporary files. Merges, archives, identity decisions, wikilink rewrites, and module switches take the same per-file locks as editor saves. Editors save as the person types (`src/renderer/src/use-autosave.ts`): after a short pause, on blur, and when their tab closes. Each save carries the revision it was based on; a refused save because the file changed on disk shows a choice between the two versions instead of retrying over it. Editors report unsaved text to the main process, which asks before closing the window or switching workspaces while any remains.

**Watching.** `src/main/workspace-watcher.ts` is one recursive `fs.watch` on the workspace, so open handles do not grow with the number of files (per-file watching previously exhausted descriptors on a workspace of about ten thousand files). It reports record folders, `pages/`, `archive/`, and the editable `.serenity` settings in batches once changes settle, and ignores derived indexes, activity writes, dotfiles, and temporary files so Serenity's own writes do not cause refresh loops.

**Document text.** `src/main/documents.ts` reads plain-text formats directly and sends PDF and DOCX to a worker thread (`src/main/extract-worker.ts`, a separate build entry) with a 60-second limit, so parsing a large document never stalls saves or other requests. If the worker cannot start, extraction falls back to the main process (`src/main/document-text.ts`).

**Search index.** `.serenity/index.sqlite` is an FTS5 table of pages, entities, unretracted claims, documents, and the tasks and events of enabled modules. Queries rank with bm25 (titles weigh most) and return a `snippet()` excerpt with the matched words marked; `src/shared/search-rank.ts` then favours records matching every word. The index is rebuilt in the background shortly after a workspace opens and after changes settle, with concurrent requests coalesced, so a search does not wait on indexing.

## Workbench

**Shell.** `src/renderer/src/main.tsx` lays out a native window: the title bar is hidden (`titleBarStyle: 'hidden'`, with the macOS traffic lights inset and Windows and Linux controls drawn over the top-right corner by `titleBarOverlay`, whose colours follow the theme through `window:theme` IPC). The top-left corner holds the sidebar toggle and the Workspace/Chat mode switch. Workspace mode has a ribbon of views (`shell-parts.tsx`, ordered by `.serenity/workbench.yaml`), a file-tree explorer (`explorer.tsx`), the panes, and an assistant sidebar (`assistant.tsx`) with a single show/hide control; Chat mode shows the conversation list and a full-window conversation. Settings (`settings-panel.tsx`), new entities, and conversation settings are dialogs (`dialog.tsx`); menus (`menu.tsx`) and toasts replace inline notices. The main process installs an application menu whose workbench items send command IDs to the renderer (`menu:command`) without registering their accelerators, so the workspace keymap stays the one place shortcuts are handled. The stylesheet (`app.css`) uses system fonts and one accent, and container queries make each pane's content follow the pane's width.

**Resources and routing.** `src/shared/resources.ts` gives file-backed and computed items stable `serenity:kind/id` URIs. A resource is an addressable handle, not a shared storage schema. `src/renderer/src/resource-routing.ts` decides how each kind opens: entities, extractable documents, and pages (Home included) open as tabs; tasks and events open their module's tab focused on them; claims open their subject; unextractable documents open in their native application. Views are tabs too, addressed as `serenity:view/<id>` (`tabViews` in `src/shared/layout.ts`); Home is a page and Settings a dialog, so neither is a view tab. Session restore, links, search, and external deletions all use this one rule.

**Views.** Built-in views (Knowledge, Review, Documents, Calendar, Tasks, Activity, Search, and the page view behind Home) are contributions in `src/renderer/src/builtin-views.tsx`, resolved through `view-registry.ts`. The registry decides availability, so a disabled module's view can neither render nor be restored. Each pane's content is wrapped in an error boundary (`error-boundary.tsx`), so a view that throws is contained to its pane.

**Presentations.** A resource can be shown several ways (`presentations.tsx`): an entity as Profile, Timeline, or Connections; a document as Text, Outline (Markdown with headings), or Knowledge from it; a page as Page or Links. The choice belongs to the tab, so one resource can be shown two ways side by side. Timeline and Connections are computed from the snapshot by `src/shared/entity-history.ts` and store nothing; retracted and superseded claims stay visible as history, and only confirmed claims count as relationships. A document's knowledge comes from `src/shared/provenance.ts`, which matches sources to documents by name, optionally followed by a location such as `, p. 2`.

**Panes.** The center is a tree of panes in the style of Obsidian. `src/shared/layout.ts` describes row and column splits with optional sizes; `layoutGeometry` turns the tree into a rectangle per pane and divider, and the shell renders every pane as an absolutely positioned sibling, so splitting, resizing, or moving tabs never remounts a pane or loses an editor's draft. `src/renderer/src/workbench-groups.ts` holds each pane's tabs, which one is shown, and per-tab presentations, with pure split, close, focus, move-tab, prune, and restore operations. Closing the shown tab shows its neighbor; a pane without tabs shows a New tab screen. `maxEditorGroups` is a policy cap, not a limit of the saved format. When panes would fall below a usable size, the shell shows one at a time with a switcher, keeping the others mounted; in narrow windows the sidebars float over the panes.

**Session.** `.serenity/session.yaml` is workspace-local UI state, separate from authored knowledge: the focused pane's fields plus a `layout` with every pane's tabs (resource and view URIs) and presentations. The main process validates it structurally and filters it to resources that still exist; a damaged layout falls back to one pane. Sessions saved by 1.x, which named a view without a tab for it, restore that view as a tab.

**Commands and keybindings.** `src/renderer/src/commands.ts` defines every command's ID, title, icon, optional module, and default chord, with a `run` handler against the small `CommandHost` interface the shell implements. `CommandRegistry` rejects invalid or duplicate IDs and is the single authority for availability, the command palette, navigation, and dispatch; each page also contributes an open command. `src/shared/keybindings.ts` normalizes chords and merges defaults with the workspace's `keybindings` map in `.serenity/workbench.yaml`; unknown IDs and conflicts are reported as warnings. Keybindings can only name registered commands, never code. The command registry is a UI foundation, not an execution API: persistent effects still go through validated IPC.

**Editor.** Pages and entity notes are edited in `src/renderer/src/markdown-editor.tsx`, a CodeMirror 6 editor with live preview. A state field computes decorations from the Markdown syntax tree: headings, emphasis, links, quotes, lists, rules, and task checkboxes show formatted, with their syntax hidden except where the focused editor's cursor is; wikilinks are found in the prose and styled by how they resolve. `serenity-query` blocks are replaced by a widget that renders `live-query.tsx` through React, and follow the snapshot as it changes. Clicking a link follows it through the same routing as the rest of the workbench. The editor only changes text; the page view adds the inline title (rewriting only the frontmatter's `title`, preserving other fields and comments) and saving.

**Pages and queries.** Pages are Markdown with frontmatter and a revision-checked body. They can link resources (`serenity:kind/id`), commands (`serenity:command/<id>`), and web or email addresses. Fenced `serenity-query` blocks hold bounded YAML selections (`src/shared/query.ts`) over the current snapshot: a source (`upcoming`, `entities`, `claims`, `documents`, `tasks`, `events`, `proposals`, `pages`, `activity`), filters including a document `source`, a limit, and a `display` of list, table, or count. Queries cannot run code or read paths. `.serenity/workbench.yaml` chooses the Home page and the views in the ribbon. Both files are user-owned and watched; invalid YAML is reported in the snapshot.

**Wikilinks.** Pages and entity narratives may use `[[Title]]` or `[[Title|label]]` (`src/shared/wikilinks.ts`). Links resolve at render time by exact title through a title index built once per snapshot; ambiguous or missing names are marked, never guessed, and no link targets are stored. Typing `[[` suggests titles. Renaming an entity or page offers to rewrite `[[old]]` in notes that resolved to it; the main process rewrites prose only (not frontmatter or code), one atomic, lock-serialized write per file.

**Search.** The palette (`command-palette.tsx`) searches commands and records together and shows excerpts. **Search in a pane** (`search-view.tsx`) keeps results open and opens each in the neighboring pane. **Ask about these results** turns the found entities and documents into a selected read scope (`src/shared/result-scope.ts`) for a new conversation.

**Derived knowledge views.** The Knowledge library filters and can draw a graph (`src/shared/library.ts`, `graph.ts`) of the most connected entities, linked by confirmed relationships and wikilinks. Activity (`src/shared/activity.ts`) groups changes by day with filters. The task board (`task-board.ts`) and calendar agenda (`calendar-agenda.ts`) regroup existing records without storing new status.

## AI

**Providers.** GitHub Copilot and OpenAI Codex are separate adapters in `src/main/providers.ts`. Their SDK tools are disabled or read-only: providers return proposed knowledge, and Serenity performs writes. Requests the user starts can be cancelled. Conversations, proposals, sources, and merge history belong to the workspace, not to a provider session, so a conversation can continue after switching providers.

**Scope and context.** Each conversation stores its autonomy and read scope. The default scope is the whole workspace; selected mode allows only chosen entities (with their claims) and documents, plus explicitly allowed conversations or module records. Scope is enforced both when assembling context (`src/main/context.ts`) and when accepting writes to existing entities. The shell passes the focused pane's resource as `activeRef`, other visible panes as `visibleRefs`, and all tabs as `openRefs`; each is filtered by scope before anything is sent. Identity decisions are included only when both entities are readable.

**Retrieval.** When a workspace does not fit a request, Serenity retrieves from the local index and sends a visible catalog with relevant excerpts, and can supply a requested follow-up excerpt. The optional semantic-index module stores AI-generated summaries and topic terms in `.serenity/semantic-index.yaml` that are ranked locally without another provider call; on-demand provider retrieval is also available (`src/main/semantic.ts`, `semantic-index.ts`). Retrieval chooses what to send; it never narrows what the person or later requests can read.

**Disclosure and citations.** Each message records the references, byte counts, excerpt offsets, and checksums that were sent, and every provider request writes an `activity/` record without copying the prompt or credentials. Providers are asked to cite the records they used; `src/shared/citations.ts` keeps well-formed references and marks whether each was actually sent and whether its quote occurs in it, so a citation is evidence to inspect, not an assertion to trust.

**Proposals and autonomy.** Proposals are reviewed in Review, grouped by source (`src/shared/proposals.ts`). A workflow can ask first, propose, or auto-save permitted proposal types; autonomous workflows start with sourced claims only, and entity, task, and event permissions are granted separately (`src/shared/workflow.ts`). New categories and ambiguous identities always go to review, where a suggested entity can be attached to an existing one or kept separate.

**Background modules.** Semantic indexing and document analysis are opt-in modules because they send workspace content to the provider. Disabling one or changing its provider cancels in-flight work first. Document analysis (on request or automatic) uses one prompt, `src/shared/analysis-prompt.ts`, asking for entities checked against existing ones, sourced facts and relationships, a task per dated deliverable, and an event per scheduled session, without inventing unstated details.

## Modules

`src/shared/modules.ts` lists the modules that can be turned off; switches live in `.serenity/modules.yaml`. Switch changes serialize with each other and with task and event saves, so one does not erase another, and a disabled module rejects later writes. A disabled module keeps its files but hides its view and commands and stops sending its records to AI. Calendar and tasks link to entities by ID rather than copying them. Removed tasks and events are archived and can be restored.

To add a built-in module: register its ID, define its records and validation, add main-process operations to the typed preload API, and contribute commands and a view. Keep module data separate from the core entity and claim records, and intact when the module is disabled. Installable third-party extensions are not part of the current architecture; a YAML entry alone can never provide executable behavior.

## Reliability

A pane that fails to render is contained by its error boundary. If the renderer process dies, the main process reloads it into the same workspace, but stops after three crashes within a minute rather than looping. Unhandled promise rejections in the main process are logged. Background work reports its own failures in the UI.

## Verification and packaging

- `npm test` runs the Node test suites for storage invariants, shared logic, and module behavior.
- `npm run smoke:desktop` launches Electron against a temporary workspace and exercises the full renderer, preload, and main-process path: files, IPC, live-preview editing and autosave, wikilinks, panes, search including PDF and DOCX, tasks, calendar, review, Settings, Chat mode, session restore, recovery from a crashed renderer, and an axe-core accessibility check of every main view in both themes that fails on serious or critical violations. It uses a temporary browser profile and `--background` (no window, no focus). It can target a packaged executable, and with an account, run a live provider turn.
- `npm run perf:desktop` times launch, navigation, typing, and search on a 2,000-entity synthetic workspace and fails over budget.
- Both drive the app through `tests/electron-harness.ts`, which `tests/ui-screens.ts` also uses to save screenshots of the main screens for visual review.
- GitHub Actions typechecks, tests, packages, and smoke-tests the packaged app on macOS, Windows, and Linux. Live provider calls need credentials and are not made in CI.

Installer icons are generated at package time from `assets/icon.svg`. Releases are drafted on GitHub with the macOS DMG and ZIP, the Linux AppImage, the Windows installer, and a `SHA256SUMS` file. macOS builds are not yet signed or notarized.
