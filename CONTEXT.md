# Serenity: project context and roadmap

This is a handoff and orientation document for the **Serenity source repository**. It describes the product we are building, what exists today (Serenity 2.0), why the architecture has this shape, and the work still needed to reach the longer-term vision. For the original product principles and detailed decisions, read [SERENITY.md](SERENITY.md); for runtime and storage invariants, read [ARCHITECTURE.md](ARCHITECTURE.md); for setup and user-facing features, read [README.md](README.md). When those documents or the code change, update this overview rather than treating a progress estimate here as a contract.

## The idea

Serenity is a cross-platform, local-first, human–AI personal knowledge environment. A person chooses a directory on their computer; that directory becomes a portable, inspectable representation of their world: people, projects, concepts, experiences, claims, documents, plans, tasks, events, conversations, and pages. The human decides what things mean and which assertions are current; AI helps retrieve, organize, connect, and propose changes. The goal is **a better relationship between people, knowledge, and AI**, not a chatbot with an attached notes pane.

The long-term interaction metaphor is a **modular “neo-Emacs” workbench**: stable resources that can be opened in different views, named commands reachable from multiple surfaces, user-authored pages that compose live information, freely arranged panes, and extensible workflows. Serenity now has the first four (resources, commands with rebindable keys, authored pages with live queries, Obsidian-style panes). It does not have user-authored commands or an installable plugin ecosystem; those need an extension trust model the owner has not yet chosen.

Principles that should survive every implementation change:

- **The chosen workspace is its own world.** Authored knowledge, pages, structured records, imported media, and workspace state live in that directory. Import external files by copying them in; do not represent a symlink or an arbitrary path elsewhere as workspace content. Provider credentials are the deliberate exception: keep them in OS-protected storage or current-session memory, never in portable workspace files. Device-level presentation preferences may also live outside the knowledge directory.
- **Human meaning stays in human hands.** Types and relationship names are extensible, not a universal fixed ontology. AI can suggest identities, categories, connections, and memories; ambiguous identity or new categories call for human judgment. The user chooses read scope and autonomy per conversation/workflow.
- **Keep evidence and corrections.** An entity's narrative is not the whole truth. Individual claims carry sources, origin, status, and potentially competing answers. Retractions, resolutions, merges, and undo history should preserve provenance instead of erasing the record.
- **The format remains usable without Serenity or AI.** Markdown and YAML files are inspectable and editable in ordinary tools; SQLite and generated semantic summaries are rebuildable indexes, not authoritative knowledge. On-device search and browsing work without a provider connection.
- **AI uses Serenity's rules.** Copilot and Codex are interchangeable integrations for inference, not owners of the data model. Providers do not get arbitrary filesystem or write tools. Requests transmit relevant permitted context; accepted writes go through Serenity's validated workflow and review/permission rules. The user can inspect which records were sent.
- **Workspaces are authored, not merely skinned.** A page, its live queries, its resource links, and navigation placement belong to the workspace. A configured menu item does not magically become executable code: commands and views still need registered, validated implementations.

## Two different directories

**This Git repository** contains the Electron application, tests, documentation, build configuration, and assets. **A selected workspace directory** is the user's data store, chosen when the app starts or via `--workspace=/path/to/directory`. It can be elsewhere on disk. Do not confuse source files under `src/` with a user's `pages/` or `.serenity/` directory.

### Repository map

| Location | Responsibility |
| --- | --- |
| `src/main/` | Electron main process: workspace filesystem access, validation, revision-checked writes, the recursive watcher, search indexing, document extraction (in a worker thread for PDF/DOCX), provider adapters, conversations and background AI. `workspace.ts` is the storage hub; `index.ts` wires Electron, security settings and IPC. |
| `src/preload/index.ts` | Small typed context-bridge API from the renderer to the main process. |
| `src/shared/` | Pure logic used by both processes: record/API types, resource URIs, pane layout, bounded queries, wikilinks, keybindings, search ranking, provenance, entity history, duplicate detection, citations, module and workflow definitions, the analysis prompt, default Home/workbench content. |
| `src/renderer/src/` | React workbench: native shell (`main.tsx`, `shell-parts.tsx`, `explorer.tsx`, `pane-header.tsx`, `menu.tsx`, `dialog.tsx`), pane model and routing, view registry and presentations, command registry, live-preview editor (`markdown-editor.tsx`) with autosave, page and entity views, knowledge/document/calendar/task/review/activity/search views, assistant and Chat mode (`assistant.tsx`), search palette, Settings dialog, and the stylesheet (`app.css`). |
| `tests/` | `*.test.ts` Node tests for storage invariants, AI scope, workflows, pages, layout, registries and shared logic; `desktop-smoke.ts` drives Electron on a temporary workspace (including an accessibility gate); `desktop-perf.ts` checks performance budgets; both use `electron-harness.ts`, as does `ui-screens.ts`, which saves screenshots of the main screens. |
| `.github/workflows/desktop.yml` | Typecheck, unit tests, package and packaged-app smoke on macOS, Windows and Linux; one run per branch at a time. |
| `assets/icon.svg`, `scripts/`, `package.json` | App identity, generated platform icons, Node scripts, dependencies and packaging configuration. |
| `README.md`, `SERENITY.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `CHANGELOG.md` | How to run it; original vision/decisions; technical invariants; this handoff and roadmap; user-visible changes per release. |

`out/`, `release/`, `build/icons/`, and `node_modules/` are generated artifacts or dependencies, not the authored product source.

### Typical selected-workspace layout

```text
my-workspace/
  pages/Home.md                 # editable Markdown + YAML frontmatter; further pages live here
  entities/<uuid>.md            # narrative and flexible entity metadata
  claims/<uuid>.yaml            # sourced assertions and relationships
  resolutions/                 # append-only current-answer decisions
  identity-decisions/          # reversible human decisions that two entity IDs are distinct
  documents/                   # copied imported originals
  conversations/               # retained conversation transcripts and settings
  proposals/                   # AI-suggested changes and review decisions
  calendar/                    # internal events, if enabled
  tasks/                       # internal tasks, if enabled
  activity/                    # provider request metadata, not duplicate raw prompts
  archive/                     # reversible merges; archived entities and tasks, legacy archived events
  trash/calendar/              # deleted events, available to restore
  .serenity/
    workbench.yaml              # Home page ID and navigation groups / command IDs
    session.yaml                # pane layout, each pane's tabs and views, assistant selection
    modules.yaml                # optional-module switches (written when configured)
    semantic-provider.yaml     # selected background-AI provider (when configured)
    index.sqlite               # rebuildable full-text search index
    semantic-index.yaml        # optional rebuildable AI-derived topic index
    analyzed-documents.yaml    # background document-analysis tracking, when used
```

Not every settings or generated file exists in a new workspace. The initial `pages/Home.md` and `.serenity/workbench.yaml` are created **only if absent**. External edits are watched; invalid records are surfaced as errors rather than silently replaced. Workspace-owned directories and files must be real in-workspace entries: symlinked workspace directories/pages/records/documents are excluded or rejected. Imports copy source bytes into `documents/`.

## How the architecture fits together

```text
Markdown/YAML files + imported documents  <- source of truth
                 |
     main-process Workspace validation
                 |  snapshot + typed operations
          Electron IPC / preload
                 |
         React workbench shell
     /         |          |          \
 resources   commands   views     authored pages
     \         |          |          /
       workspace-owned session (current view/tabs)
                 |
 contextual assistant -> permitted retrieval -> Copilot or Codex
                         <- response / proposed changes
                 -> Serenity validation + review/autonomy -> files
```

**Runtime boundary.** The renderer has no Node filesystem or direct credentials. The main process selects and validates workspace files, handles provider requests, and exposes a bounded typed API through preload. Filesystem access and AI writes are not inferred from a page link or command label. The file watcher refreshes authored state without letting derived-index/activity writes create an indexing loop.

**Storage vs. addresses vs. presentation.** A stable `serenity:kind/id` URI addresses a page, entity, claim, document, task, event, conversation, or proposal. For example, `serenity:entity/<uuid>` or `serenity:page/home`. These are handles, not a mandate to store every resource in the same schema. `src/shared/resources.ts` produces and parses them; `WorkspaceSnapshot` describes currently available items. A view chooses **how** to display a resource; it does not become the owner of its underlying file. `.serenity/session.yaml` records the pane layout with each pane's tabs and views, and restoration drops references that no longer exist.

**Commands.** Named built-in actions such as `view.knowledge`, `entity.create`, `layout.split`, and `documents.import` are contributed in `src/renderer/src/commands.ts`, each with its own `run` handler against a small `CommandHost` the shell implements and an optional default chord. `CommandRegistry` registers them alongside generated page-opening commands, rejects duplicate IDs, and checks module availability for discovery and dispatch. The palette, navigation, keybindings, and page links reuse those identities; persistent operations still cross validated IPC. A workspace can override or remove chords with a `keybindings` map in `.serenity/workbench.yaml` (normalized and resolved by `src/shared/keybindings.ts`; conflicts and unknown IDs appear as warnings). This is still an **internal contribution list**, not user-authored command code or an extension API.

**Views and panes.** `src/renderer/src/resource-routing.ts` decides how each `serenity:` URI opens (a tab in its default view, a module tab focused on a task or event, a native open, or a conversation); views such as Calendar are tabs too, saved as `serenity:view/<id>`. `view-registry.ts` registers central views (contributed by `builtin-views.tsx`, including a Search view) and is the single authority for whether a view is available, including during session restore. The center is a tree of **panes**, as in Obsidian: `src/shared/layout.ts` is a split tree with sizes, and `workbench-groups.ts` gives each pane its own tabs, shown tab, and per-tab presentations; an empty pane shows a New tab screen. (Code still says "groups" for panes.) Panes split in any direction, resize by dividers, accept dragged tabs, and fall back to one at a time on narrow windows; each is wrapped in an error boundary. Page and entity editors are live-preview CodeMirror editors that save as you type, with revision checks and a choice when the file changed on disk. A resource can have several **presentations**: an entity's Profile, Timeline, and Connections; a document's Text, Outline, and Knowledge from it; a page's Page and Links. The AI receives the focused resource, what other panes show (`visibleRefs`), and open tabs, all filtered by read scope.

**Authored pages.** Pages are `.md` with YAML frontmatter (`id`, `title`, `kind: page`) and revision-checked edits. Home is `pages/Home.md`, a user-editable template opened as an ordinary page tab. A `serenity:` link can open a resource or invoke an existing named command. A fenced `serenity-query` block is bounded YAML, not JavaScript or a filesystem query. Supported `from` sources are `upcoming`, `entities`, `claims`, `documents`, `tasks`, `events`, `proposals`, `pages`, and `activity`; a `source` filter matches a document name with an optional location; `display` shows a list, a table, or a count; supported filters and sorts depend on source, and the maximum `limit` is 100. For instance:

````markdown
```serenity-query
from: proposals
where:
  status: pending
limit: 5
```
````

`.serenity/workbench.yaml` points `homePage` at an existing page ID and lists navigation groups with registered command IDs. Adding page text or rearranging navigation requires no React edit. Adding a new kind of executable behavior does.

**Knowledge and AI.** Entities have stable IDs and editable Markdown narratives. Claims keep individual sourced assertions, confirmations, proposed/retracted states, and conflicts. Current-answer resolutions can be reversed; merging duplicates archives the original and retains redirects/history. A human can also mark two active entity IDs as distinct in a versioned YAML record under `identity-decisions/`; the decision follows later merge redirects, suppresses the resulting duplicate suggestion, and blocks merging the two sides until it is undone without deleting the record. Human-reviewed AI proposals can create sourced claims/entities/tasks/events, or attach suggested entity context to an existing identity without replacing its narrative. Conversation read scope defaults to the chosen workspace and can be restricted to selected resources; it is enforced when constructing context and when accepting affected writes. For oversized workspaces, local retrieval selects excerpts while keeping the full eligible workspace available for later retrieval. Conversation messages record references, sizes, offsets, and checksums of transmitted context. Provider activity records operation, references, prompt size/checksum, and outcome, not extra raw prompts.

**Modules and search.** Calendar and Tasks are internal modules linking to entities by ID. Disabling a module retains its files but hides its view and blocks its writes/AI context. Automatic document analysis and AI semantic indexing are separate opt-in modules, off by default; both may send content to the selected provider. SQLite FTS5 provides rebuildable local text search with highlighted excerpts, rebuilt in the background. An optional generated topic-term index supports local sparse-vector-style matching; on-demand Copilot/Codex semantic search is separate. This is **not** a persistent neural-embedding database. Imported text, Markdown, CSV, JSON, YAML, PDF and DOCX are text-extractable; other formats can still be kept and opened natively.

### Why this is better than a hardcoded dashboard

Before the workspace-page and contribution work, a screen such as Home was primarily application JSX, and navigation and screen selection lived in shell code. Changing what Home showed meant changing and shipping the app. Now the workspace owns its Home content, other pages, bounded live lists, and navigation order. Resource URIs decouple references from filenames and presentation; named commands let several UI surfaces invoke the same action; the view registry isolates central presentations and module availability. The same local files remain legible outside Serenity, while the Electron main process retains control over filesystem and AI writes. These foundations make deeper customization possible **without** pretending that YAML alone is an executable plugin platform.

## What works today

Serenity 2.0 is a finished, hardened desktop workbench for the agreed initial scope, rebuilt in 2.0 to look and behave like a native app.

- **App.** Packaged for macOS, Windows, and Linux; dark-first with Light and System appearances. Content reaches the title bar. Workspace mode has a ribbon of views, a file-tree explorer, tabbed panes, and an assistant sidebar with one toggle; Chat mode is a full-window conversation. There is an application menu, a search palette, Settings as a dialog, and a New tab screen.
- **Knowledge.** Entities with narratives and sourced claims; corrections and reversible current-answer resolutions; timelines (filterable by kind) and connections per entity; duplicate suggestions with evidence, side-by-side comparison, reversible merges, and reversible "distinct" decisions; a Knowledge library with filters and a graph.
- **Pages.** An editable `pages/Home.md` and more pages, always editable in live preview and saved as you type, with inline titles; `[[wikilinks]]` with suggestions, backlinks, and rename updates; resource, command, web, and email links; bounded live `serenity-query` lists, tables, and counts; Home and navigation configured in workspace YAML; empty lists explain how things arrive.
- **Documents.** Imports copied into the workspace; text, outline, and "knowledge from it" views; PDF/DOCX extracted off the main process; unsupported formats open natively.
- **Workbench.** Everything is a tab, views included; Obsidian-style panes (split, resize, drag tabs, directional focus, narrow fallback) and per-tab views, restored with the workspace; tab shortcuts (new, close, next, previous); a command registry with per-workspace keybindings and commands for views, layout, and appearance; a search pane that keeps results open.
- **Calendar and tasks.** Internal modules with day/week/month/agenda and list/board views, event Trash and restore, task archive and restore, and on/off switches that keep data.
- **Assistant.** Copilot or Codex, switchable within a conversation, in the sidebar or full-window; read scope and autonomy per conversation (including "ask about these search results"); focused and visible panes as context; disclosed context and provider activity; cancellable requests; checked citations; proposals reviewed by source and beside their document; structured document analysis and "suggest connections"; optional background analysis and semantic indexing.
- **Reliability.** Revision-checked, serialized writes; ordered snapshots; damaged settings preserved beside a fresh start; per-pane error boundaries and bounded crash recovery; a watcher that scales to large workspaces; background search indexing.
- **Verification.** Unit tests, a desktop smoke test with an axe-core gate over every main view in both themes, performance budgets, and CI that smoke-tests packaged builds on all three platforms. Live Copilot and Codex turns were tested from the packaged macOS app; CI makes no live provider calls.

## Release status (2026-09-28)

- **2.0.0** rebuilds the interface as a native workbench: title-bar tabs, ribbon and explorer, views as tabs, a live-preview editor with autosave, Chat mode, dialogs, and an application menu. It keeps the workspace format; sessions from 1.x restore.
- **1.0.0** (`v1.0.0`) was the first desktop release. **1.1.0** (`v1.1.0`, commit `8a7d8d3`) adds search excerpts and a search pane, questions scoped to search results, structured document analysis, query tables and counts, timeline filters, and PDF/DOCX extraction in a worker thread.
- **2.0.2** is the release containing the calendar refresh/drag fix, corrected macOS titlebar dividers, and Documents button emphasis. Releases hold the CI-built installers (DMG and ZIP for Apple silicon, the x64 Windows installer, an x64 Linux AppImage), `SHA256SUMS`, and notes from `CHANGELOG.md`. Older 1.0.0, 2.0.0, and 2.0.1 drafts are superseded. Installers are published only after the matching commit passes packaged smoke tests on all three platforms.
- `SERENITY_SMOKE_WINDOW=900x640 npm run smoke:desktop` repeats the smoke test in a small window, where the sidebars float; Windows CI machines use such a window.
- Builds are unsigned. Signing and notarizing for macOS, and signing for Windows, need the owner's certificates.
- New user-visible changes go under a new heading in `CHANGELOG.md`.

## Remaining work

The initial desktop scope is complete; what follows is the longer-term vision, roughly in order.

1. **Use and polish.** Improve the workbench from real use: more presentations for other resource kinds, keyboard and focus details, responsive layouts, empty and error states, richer temporal views and retrieval ergonomics. PDF and DOCX extraction does not preserve reliable headings, so Serenity deliberately shows no inferred outline for them. Import uses the native file picker; drag-and-drop import can be designed around the renderer-to-main path boundary.
2. **Hardening at scale.** Keep exercising migrations, recovery, performance, packaging, and real-provider behavior against larger and older workspaces. A fixture from the first workspace layout already opens unchanged in the current app.
3. **Distribution.** Signed and notarized builds and an update mechanism, once the owner provides certificates and chooses an update channel.
4. **Extensions.** Define versioned contribution contracts for resources, views, commands, and module data, then decide **with the owner** the trust boundary for user-installed code (sandboxing, capabilities, updates) before building a plugin loader. Pages should be able to compose richer views without Markdown or YAML becoming executable.
5. **Later platforms and integrations.** External actions, external calendar sync, cloud or device sync, local models, mobile, and simultaneous workspaces are future goals, not features. External calendar sync is not the same as Serenity's internal Calendar.

## Decisions and how to make more

The owner has decided: Electron desktop first on all three platforms; Copilot and Codex as separate integrations; Markdown/YAML with a separate claim history and SQLite as a rebuildable index; per-workflow autonomy starting in read-and-propose; Obsidian-style arbitrary split panes; explicit, reversible "these two entities are distinct" records; and a finished, hardened desktop workbench as the first release. These are recorded in [SERENITY.md](SERENITY.md).

There is no approved specification yet for installable plugins, external actions, or a mobile/sync architecture. Before choosing an irreversible knowledge representation, ontology, memory rule, autonomy boundary, or extension trust model, explain the problem, options, tradeoffs, and a recommendation to the owner and let them decide. Prefer incremental changes with tests for storage, scope, and restoration invariants.

## Working on this project

Requires Node.js 24 or newer:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run smoke:desktop
npm run perf:desktop
npm run dist
```

The smoke and performance tests need a graphical desktop. They launch the app with `--background` (hidden, never takes focus) and a temporary browser profile; `SERENITY_SMOKE_VISIBLE=1` shows the window. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` opts into a live authenticated conversation, which uses your provider quota; `SERENITY_SMOKE_EXECUTABLE` points the smoke test at a packaged executable. If your shell inherits `ELECTRON_RUN_AS_NODE=1` (some Electron-based terminals and agents set it), unset it first. See [README.md](README.md) for packaging variants and user instructions.

Inspect `git status` and the diff before changing or committing files, and check the CI run for the latest commit. This document is a snapshot of the project, not a substitute for reading the current code and tests before editing them.
