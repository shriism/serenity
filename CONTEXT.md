# Serenity: project context and roadmap

This is a handoff and orientation document for the **Serenity source repository**. It describes the product we are building, the implementation that exists today, why its architecture is taking this shape, and the work still needed to reach the longer-term vision. For the original product principles and detailed decisions, read [SERENITY.md](SERENITY.md); for runtime and storage invariants, read [ARCHITECTURE.md](ARCHITECTURE.md); for setup and user-facing features, read [README.md](README.md). When those documents or the code change, update this overview rather than treating a progress estimate here as a contract.

## The idea

Serenity is a cross-platform, local-first, human–AI personal knowledge environment. A person chooses a directory on their computer; that directory becomes a portable, inspectable representation of their world: people, projects, concepts, experiences, claims, documents, plans, tasks, events, conversations, and pages. The human decides what things mean and which assertions are current; AI helps retrieve, organize, connect, and propose changes. The goal is **a better relationship between people, knowledge, and AI**, not a chatbot with an attached notes pane.

The long-term interaction metaphor is a **modular “neo-Emacs” workbench**: stable resources that can be opened in different views, named commands reachable from multiple surfaces, user-authored pages that compose live information, and eventually configurable pane layouts and extensible workflows. This is a direction, not a claim that Serenity already has Emacs-style customizability or an installable plugin ecosystem.

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
| `src/main/` | Electron main process; workspace filesystem access, validation, indexing, import/extraction, provider adapters, conversations and background AI. `workspace.ts` is the storage hub; `index.ts` wires Electron and IPC. |
| `src/preload/index.ts` | Small typed context-bridge API from the renderer to the main process. |
| `src/shared/` | Record/API types, resource URIs, bounded query evaluation, module and workflow definitions, default Home/workbench content, identity and deduplication helpers. |
| `src/renderer/src/` | React workbench: shell, authored-page editor, knowledge/document/calendar/task/review views, contextual assistant, search/command palette, navigation, view and command contributions, themes and styles. |
| `tests/` | Node tests for data invariants, AI scope, workflows, pages and registries; `desktop-smoke.ts` exercises Electron and a temporary workspace. |
| `.github/workflows/desktop.yml` | Typecheck, unit tests, package and packaged-app smoke on macOS, Windows and Linux. |
| `assets/icon.svg`, `scripts/`, `package.json` | App identity, generated platform icons, Node scripts, dependencies and packaging configuration. |
| `README.md`, `SERENITY.md`, `ARCHITECTURE.md`, `CONTEXT.md` | How to run it; original vision/decisions; technical invariants; this handoff and roadmap. |

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
  archive/                     # reversible merges; archived entities, events, tasks
  .serenity/
    workbench.yaml              # Home page ID and navigation groups / command IDs
    session.yaml                # last view, open/active resource URIs, assistant selection
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

**Storage vs. addresses vs. presentation.** A stable `serenity:kind/id` URI addresses a page, entity, claim, document, task, event, conversation, or proposal. For example, `serenity:entity/<uuid>` or `serenity:page/home`. These are handles, not a mandate to store every resource in the same schema. `src/shared/resources.ts` produces and parses them; `WorkspaceSnapshot` describes currently available items. A view chooses **how** to display a resource; it does not become the owner of its underlying file. `.serenity/session.yaml` records the last open addresses and view, and restoration drops references that no longer exist.

**Commands.** Named built-in actions such as `view.knowledge`, `entity.create`, `layout.split`, and `documents.import` are contributed in `src/renderer/src/commands.ts`, each with its own `run` handler against a small `CommandHost` the shell implements and an optional default chord. `CommandRegistry` registers them alongside generated page-opening commands, rejects duplicate IDs, and checks module availability for discovery and dispatch. The palette, navigation, keybindings, and page links reuse those identities; persistent operations still cross validated IPC. A workspace can override or remove chords with a `keybindings` map in `.serenity/workbench.yaml` (normalized and resolved by `src/shared/keybindings.ts`; conflicts and unknown IDs appear as warnings). This is still an **internal contribution list**, not user-authored command code or an extension API.

**Views and layout.** `src/renderer/src/resource-routing.ts` decides how each `serenity:` URI opens (tab in its default view, Home, module focus, native open, conversation). `view-registry.ts` registers central views (contributed by `builtin-views.tsx`) and is the single authority for whether a view is available, including during session restore. The center is a composition of **editor groups**: `src/shared/layout.ts` is a split tree over groups, `workbench-groups.ts` gives each group its own view, tabs, shown resource, and per-tab presentation. Panes split any direction without a practical limit (Obsidian-style, per the owner's direction), resize by dividers, accept dragged tabs, and fall back to one-at-a-time on narrow windows. Editors (pages, entities) own their drafts and report unsaved state per group. A resource can have several **presentations**; an entity offers Profile, Timeline, and Connections (`src/shared/entity-history.ts`, derived from the snapshot, no stored data). The AI receives the focused resource, what other groups show (`visibleRefs`), and open tabs, all filtered by read scope.

**Authored pages.** Pages are `.md` with YAML frontmatter (`id`, `title`, `kind: page`) and revision-checked edits. Home is `pages/Home.md`, a user-editable template. A `serenity:` link can open a resource or invoke an existing named command. A fenced `serenity-query` block is bounded YAML, not JavaScript or a filesystem query. Supported `from` sources are `upcoming`, `entities`, `claims`, `documents`, `tasks`, `events`, `proposals`, `pages`, and `activity`; a `source` filter matches a document name with an optional location; supported filters and sorts depend on source, and the maximum `limit` is 100. For instance:

````markdown
```serenity-query
from: proposals
where:
  status: pending
limit: 5
```
````

`.serenity/workbench.yaml` points `homePage` at an existing page ID and lists navigation groups with registered command IDs. Adding page text or rearranging navigation requires no React edit. Adding a new kind of executable behavior does.

**Knowledge and AI.** Entities have stable IDs and editable Markdown narratives. Claims keep individual sourced assertions, confirmations, proposed/retracted states, and conflicts. Current-answer resolutions can be reversed; merging duplicates archives the original and retains redirects/history. A human can also mark two active entity IDs as distinct in a versioned YAML record under `identity-decisions/`; the decision suppresses that duplicate suggestion and blocks merging the pair until it is undone, without deleting the record. Human-reviewed AI proposals can create sourced claims/entities/tasks/events, or attach suggested entity context to an existing identity without replacing its narrative. Conversation read scope defaults to the chosen workspace and can be restricted to selected resources; it is enforced when constructing context and when accepting affected writes. For oversized workspaces, local retrieval selects excerpts while keeping the full eligible workspace available for later retrieval. Conversation messages record references, sizes, offsets, and checksums of transmitted context. Provider activity records operation, references, prompt size/checksum, and outcome, not extra raw prompts.

**Modules and search.** Calendar and Tasks are internal modules linking to entities by ID. Disabling a module retains its files but hides its view and blocks its writes/AI context. Automatic document analysis and AI semantic indexing are separate opt-in modules, off by default; both may send content to the selected provider. SQLite provides rebuildable local text search. An optional generated topic-term index supports local sparse-vector-style matching; on-demand Copilot/Codex semantic search is separate. This is **not** a persistent neural-embedding database. Imported text, Markdown, CSV, JSON, YAML, PDF and DOCX are text-extractable; other formats can still be kept and opened natively.

### Why this is better than a hardcoded dashboard

Before the workspace-page and contribution work, a screen such as Home was primarily application JSX, and navigation and screen selection lived in shell code. Changing what Home showed meant changing and shipping the app. Now the workspace owns its Home content, other pages, bounded live lists, and navigation order. Resource URIs decouple references from filenames and presentation; named commands let several UI surfaces invoke the same action; the view registry isolates central presentations and module availability. The same local files remain legible outside Serenity, while the Electron main process retains control over filesystem and AI writes. These foundations make deeper customization possible **without** pretending that YAML alone is an executable plugin platform.

## What works today

- Choose a workspace and use a packaged Electron app on macOS, Windows, or Linux; dark-first shell with Light/System themes, navigation dock, central content, search/actions palette, and AI rail.
- Create/edit knowledge entities, sourced claims, corrections and current-answer resolutions; merge and undo duplicate entities with history retained, or mark a suggested pair distinct and undo that decision later.
- Import documents as owned copies; search and preview supported content; open files natively; request analysis or opt into automatic analysis.
- Use internal linked calendar and tasks, archive/restore them, toggle modules without deleting their records.
- Hold retained or ephemeral conversations with Copilot or Codex, switch providers within visible conversation history, inspect shared context, cancel requests, review proposed writes, choose read scope and bounded autonomy.
- Search locally, run on-demand semantic search, and optionally generate/search a rebuildable topic index.
- Edit `pages/Home.md` and create more workspace pages, embed bounded live queries and resource/command links, configure Home/navigation in workspace YAML, and restore session state from that workspace.
- Split the center into any arrangement of resizable panes, drag tabs between them, open resources to the side, and restore that layout; view an entity as its profile, timeline of recorded/corrected knowledge, or connections; review AI suggestions grouped by source and beside the document they came from; rebind command shortcuts per workspace.
- Link pages, entities, and documents with Obsidian-style `[[wikilinks]]` (with `[[` suggestions, backlinks in Connections, and link updates on rename); see what the workspace learned from each document; get answers that cite the records they used, with unverified citations flagged; review possible duplicate entities side by side; filter a large Knowledge library by name and type.
- Run typecheck, unit tests, Electron smoke tests, and packaged smoke tests in the cross-platform CI workflow. Previous packaged macOS runs also exercised live Copilot and Codex with configured accounts; CI does not run live provider calls.

This is an **implemented desktop foundation**, not a finished general workbench. The earlier rough estimate was **~35% of the full long-term vision**, with architecture foundations ~70%, today's usable product ~45%, and the specifically “neo-Emacs” interaction model ~20%. These are subjective planning indicators, **not** a computed completion metric or a promise of release timing. A narrower measure of the agreed initial desktop scope would be substantially higher; the 35% includes aspirational composition and extensibility.

## Remaining work, in a sensible order

### 1. Finish internal resource/view composition (largely done)

- Done: resource routing, per-command handlers and workspace keymaps, editor-owned drafts, Obsidian-style panes on the split tree (resizable, drag-and-drop tabs, narrow fallback), per-tab presentations, session restore of all of it, and snapshot ordering so late replies cannot overwrite newer state.
- Done: directional pane focus by the neighboring pane's position, and a task board that groups existing tasks by due date without adding a workflow status to stored records.
- Done: the Tasks list/board choice is saved per pane in the workspace session; the search palette traps Tab and restores focus when closed.
- Done: imported Markdown documents expose an outline of explicit headings, with bounded text rendering when jumping to a distant section.
- Done: closing a tab or pane moves keyboard focus to a surviving tab or pane, with a visible pane focus ring.
- Done: non-Home pages can switch between their authored Page and a Links view showing resolved outgoing resources, unresolved names, and incoming wikilink mentions.
- Done: Calendar can switch between Month and an Agenda of that month's events and open due tasks; the choice is saved per pane.
- Remaining: broader presentations for other resource kinds and further keyboard focus polish. PDF and DOCX extraction does not preserve reliable heading structure, so Serenity does not invent an outline for them.

### 2. Make customization coherent, then consider installed extensions

- Done: command registry for metadata, module availability, dispatch, keybinding identity, palette/navigation/menu discovery, and duplicate-ID errors; workspace-controlled keymaps. Workspace switching, opening its folder, and assistant expansion now use discoverable commands. Remaining: review other shell controls for useful command identities.
- Define versioned contribution contracts for resources, views, commands, navigation, and optional data/module behavior. Decide the boundary for user-installed code (trust, sandbox/process isolation, capabilities, updates) **with the human** before implementing a plugin loader. The present registry only supports internal TypeScript contributions shipped with Serenity.
- Let workspace pages compose richer, predictable views without opening arbitrary code execution through Markdown/YAML. Preserve portability and clear failure states for missing commands/extensions.

### 3. Deepen the actual personal-knowledge experience

- Done in the September 2026 pass: entity timelines and connections, citations checked against sent context, duplicate-identity review with evidence, review beside the source document, document provenance, wikilinks and backlinks, search ranking, and large-workspace performance (about 140 ms snapshots and 11 ms duplicate detection for 2,000 entities and 8,000 claims).
- Done: explicit, reversible distinct-identity decisions in workspace YAML, with duplicate suppression, a merge guard, review UI, and read-scope-aware AI context.
- Remaining: deeper temporal views and page/task presentations, and richer retrieval ergonomics.
- Continue iteration on accessibility, focus/keyboard behavior, responsive window sizes, empty/error states, and the quiet native-workbench UI based on actual use.

### 4. Product hardening and later platforms

- Done: invalid workspace session YAML or top-level state is moved to a `.corrupt-<id>` sibling before the workbench starts fresh; a new valid session can then be saved. A damaged pane layout inside an otherwise valid session still falls back to its single-pane fields. Correcting unreadable module or provider settings also keeps the old file in a `.corrupt-<id>` sibling. A damaged semantic index is preserved and can be rebuilt from workspace records.
- Exercise migrations, recovery, performance, packaging and real-provider behavior against larger and older workspaces. Keep the data format readable, recoverable and reversible when settings or indexes are damaged.
- Decide if and when to support external integrations/actions, cloud/device sync, local models, mobile access, or simultaneous workspaces. These are **future goals**, not existing features. External calendar sync is not the same as Serenity's internal Calendar.

The owner chose to finish and harden the desktop workbench as the first release milestone, and approved the now-implemented explicit, reversible workspace record for "these two entities are not the same." Decisions still waiting: whether drag-and-drop import may pass file paths from the renderer to the main process (a boundary the architecture currently avoids), and whether to run a live Copilot/Codex smoke turn to confirm providers return citations in practice.

There is no final approved specification yet for general panes, installable plugins, external actions, or a mobile/sync architecture. Before choosing an irreversible knowledge representation, ontology, memory rule, autonomy boundary, or extension trust model, explain the problem, options, tradeoffs and recommendation to the human and let them decide. Prefer incremental improvements with tests for storage, scope and restoration invariants rather than declaring the whole architecture complete at once.

## Working on this project

Requires Node.js 24 or newer:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run smoke:desktop
npm run dist
```

The smoke test needs a graphical desktop. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` opts into a live authenticated conversation; `SERENITY_SMOKE_EXECUTABLE` points it at a packaged executable. See [README.md](README.md) for packaging variants and user instructions. Inspect `git status` and the diff before changing or committing files; do not overwrite in-progress work while following this roadmap. It launches the app with `--background` (hidden, never takes focus) and a temporary browser profile; `SERENITY_SMOKE_VISIBLE=1` shows the window. When running it from a shell that inherits `ELECTRON_RUN_AS_NODE=1` (some Electron-based terminals and agents), unset it first.

The last pushed foundation commits are `5f3752c` (workspace pages/resources/commands) and `9fb3d28` (built-in view contributions), which passed CI on macOS, Windows and Linux. Later work is committed on `main` locally and has not yet been pushed or run in CI; see `git log`. This document is a snapshot of the project, not a substitute for reading the current code and tests before editing it.
