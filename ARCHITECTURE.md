# Architecture

Serenity is an Electron application with a React workbench, a validated main-process workspace API, and readable on-disk records. This document describes the implemented boundaries. [SERENITY.md](SERENITY.md) records product decisions; [CONTEXT.md](CONTEXT.md) tracks current status and future work.

## Process boundaries

| Layer | Responsibility |
| --- | --- |
| `src/renderer/` | React views, editors, commands, panes, and assistant UI. The renderer is sandboxed, context-isolated, and has no direct Node.js or filesystem access. |
| `src/preload/` | A typed, limited bridge from the renderer to validated main-process operations. |
| `src/main/` | Workspace selection and file I/O, revision-checked writes, indexing, document extraction, credentials, provider SDKs, and Electron lifecycle. |
| `src/shared/` | Pure types and logic for resources, layout, queries, links, search, provenance, citations, modules, and workflows. |

The window rejects navigation, new windows, and permission requests. Markdown links to the web or email are checked in the main process; only `http`, `https`, and `mailto` are accepted. The renderer can reveal the active workspace, not an arbitrary path. Imported files are copied into the selected folder, and symlinked records or directories are excluded. Recent workspace paths live in app settings; only a path selected by the folder picker or supplied at launch can enter that list. Credentials are stored by the operating system when available or held for the session, never written to the workspace.

## Workspace format

The selected directory is the source of truth for authored knowledge. `.serenity/index.sqlite` and the optional semantic index are derived from its records.

| Path | Contents |
| --- | --- |
| `pages/`, `entities/` | Markdown with YAML frontmatter; entity IDs remain stable across renames. |
| `claims/`, `resolutions/` | Sourced assertions and reversible current-answer decisions. |
| `identity-decisions/` | Versioned decisions that two entities are distinct. |
| `documents/` | Copies of imported files. |
| `conversations/`, `proposals/` | Retained transcripts and reviewable AI suggestions. |
| `calendar/`, `tasks/` | Internal event and task records. |
| `activity/` | Provider operation metadata and record references. |
| `archive/`, `trash/` | Reversible removals and merge history; deleted calendar events move to `trash/calendar/`. |
| `.serenity/` | Modules, workbench, session and provider settings, plus rebuildable indexes. |

Types and relationship names are user-defined strings. Claims keep their sources and status; a correction or current-answer selection does not erase conflicting history. A merge archives the duplicate entity, records a redirect, and can be undone. A distinct-identity decision suppresses duplicate suggestions and blocks a merge until the decision is undone. Known YAML fields are updated in place so custom fields and comments survive application edits.

Invalid externally edited records surface as workspace issues. Damaged session or settings files are preserved with a `.corrupt-<id>` suffix before a fresh file is created. A damaged search index is set aside and rebuilt. Permission failures still surface as errors.

## Consistency and indexing

The renderer consumes ordered `WorkspaceSnapshot` values. Reads reuse unchanged file parses but recheck ownership and file type; snapshots carry generations so a slow refresh cannot overwrite newer state. A single recursive watcher batches file changes without opening a handle per record.

Editors autosave after a pause, on blur, and when a tab closes. Each save includes the revision it read; concurrent external edits trigger a conflict choice rather than an overwrite. File writes are serialized and atomic. Merges, archives, link updates, identity decisions, and module switches coordinate with editor saves through the same locks. Unsaved edits prompt before workspace changes or window close.

SQLite FTS5 indexes pages, entities, active claims, documents, and enabled task and event records. It rebuilds in the background and returns ranked excerpts. Text formats are read directly; PDF and DOCX extraction runs in a worker with a time limit so large documents do not block edits. An optional generated topic index adds local AI-assisted terms, while on-demand provider retrieval is a separate operation. Neither index changes the underlying read permissions.

## Resource composition

`src/renderer/src/main.tsx` composes the desktop workspace and restores its session. Layout adapts to the available window size while preserving open resources and work in progress.

`src/shared/resources.ts` assigns stable `serenity:kind/id` addresses. `resource-routing.ts` sends each address to an appropriate presentation, module, related record, or native application. Built-in views register through `builtin-views.tsx` and `view-registry.ts`, which also enforces module availability. A resource can have multiple presentations, and each rendered work area has an error boundary. The command registry supplies actions throughout the application; workspace bindings and navigation order are stored in `.serenity/workbench.yaml`.

Authored pages may contain `[[wikilinks]]`, resource links, named command links, and bounded `serenity-query` YAML blocks. Queries read registered workspace sources with a maximum limit of 100; they are not executable scripts. The Home page is an editable page, not a separate dashboard implementation.

## AI and permissions

Copilot and Codex are separate provider adapters in the main process. Serenity owns conversation records, provenance, and review rules. Switching providers continues the visible transcript, but provider-private state does not move between them. Provider tools cannot write workspace files directly; changes pass through Serenity's validated workflow.

A conversation has a read scope and an autonomy setting. Context assembly filters focused, visible, and open resources by scope; large eligible workspaces are retrieved in excerpts as needed. The message records references, sizes, offsets, and checksums for transmitted context. Activity records operation metadata without duplicating the prompt. Citation validation checks that the cited record was sent and that quoted text appears in it.

Proposals can create sourced claims, entities, tasks, or events and are reviewed beneath the reply or in Review, grouped by source. Autonomous mode initially permits sourced claims only; entity, task, and event permissions are separate. New categories and ambiguous identities still require human review. Optional background document analysis and semantic indexing are off by default because they may send content to the chosen provider; changing or disabling a module cancels its work. Disabling Calendar or Tasks keeps their files and blocks new writes and AI context for the disabled module.

## Verification and release

`npm run typecheck`, `npm test`, and `npm run build` cover types, shared and storage behavior, and bundling. `npm run smoke:desktop` exercises the renderer, preload, and main process against a temporary workspace, including both themes and an axe-core accessibility gate. `npm run perf:desktop` checks launch, navigation, typing, and search on a large synthetic workspace. GitHub Actions packages and smoke-tests macOS, Windows, and Linux artifacts; live provider requests are excluded from CI. Releases include the platform installers and checksums. Current builds are unsigned.
