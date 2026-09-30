# Architecture

Serenity is an Electron application. Readable workspace files hold knowledge and decisions; the main process derives snapshots and search indexes; a sandboxed React renderer presents and edits them. Provider requests are separate operations whose results can enter the workspace through proposals.

This document describes implementation boundaries and known gaps. Product interactions and open design questions belong in [SERENITY.md](SERENITY.md); build and test instructions belong in [CONTEXT.md](CONTEXT.md).

## Processes and authority

| Layer | Responsibility |
| --- | --- |
| [`src/renderer/`](src/renderer/) | Editors, resource views, review, assistant UI, and workbench layout. No direct Node.js or filesystem access. |
| [`src/preload/index.ts`](src/preload/index.ts) | Typed IPC bridge exposing application operations. |
| [`src/main/index.ts`](src/main/index.ts) | Electron lifecycle, IPC validation, workspace selection, watchers, and background jobs. |
| [`src/main/workspace.ts`](src/main/workspace.ts) | File validation, reads, mutations, snapshots, and local search. |
| [`src/shared/`](src/shared/) | Types and pure logic for identity, provenance, citations, queries, layout, and workflow permissions. |

The window uses sandboxing and context isolation, rejects navigation and new windows, and denies browser permission requests. External links pass through a main-process check accepting HTTP, HTTPS, and mailto schemes. Workspace operations check ownership and file type; symlinked content is excluded. Imports copy files into the workspace.

These checks protect application file operations. They are distinct from the provider runtime boundary described below.

## Storage and derived state

| Location | Role |
| --- | --- |
| `pages/`, `entities/` | Markdown with YAML frontmatter; stable IDs identify records independently of display titles. |
| `claims/` | Statements with subject, key, value, source, origin, status, and recording time. |
| `resolutions/` | Separate decisions selecting or clearing a current claim for a subject/property. |
| `identity-decisions/` | Versioned distinct-identity decisions, including undone decisions. |
| `documents/` | Imported copies and authored document files. |
| `conversations/`, `proposals/` | Retained messages and suggestions with acceptance/rejection state. |
| `tasks/`, `calendar/` | Internal planning records and related entity IDs. |
| `activity/` | Provider operation metadata, references, timing, and status. |
| `archive/entities/`, `archive/merges/` | Merge history needed to reverse identity decisions. |
| `.serenity/` | Settings, workbench/session state, analysis tracking, and derived indexes. |

The directory is the source of truth for stored records. SQLite FTS5 in `.serenity/index.sqlite` is a rebuildable search projection. `.serenity/semantic-index.yaml` contains generated summaries, terms, and input fingerprints; regeneration can require provider calls and produce different output. Settings and history are not derived indexes. Backups should include the complete workspace.

Source attribution is a string. [`provenance.ts`](src/shared/provenance.ts) associates it with an imported document by filename and an optional location suffix. It is not a versioned evidence pointer. Known-field updates in several YAML mutation paths preserve custom fields and comments, but not every write path preserves the original serialization.

Credentials managed by Serenity live outside the workspace in application user data, encrypted through Electron `safeStorage` where supported. Otherwise they remain in session memory. Provider SDK authentication and runtime state may also exist outside the workspace.

## Statements, current answers, and identity

A snapshot parses records, resolves active merge redirects, and computes the current claim designation. Resolutions are ordered by sequence, then timestamp and ID; the latest decision for a subject/property determines its selected claim. Only a confirmed claim receives the current designation. Selecting or clearing an answer appends a resolution. Retraction changes claim status and records a reason; if necessary, it appends a decision clearing the current answer.

`confirmed` is an acceptance state. Human additions and accepted AI proposals both use it. AI origin and proposal metadata remain separate. Neither acceptance nor current selection verifies the assertion.

Merging archives the source entity and writes a redirect. Snapshot projection follows redirects for claim subjects and entity-valued relationships while the underlying claim files retain original IDs. Undo restores the entity and moves the annotated merge record into history. Active distinct-identity decisions are checked through current redirects and block merges that would collapse a protected pair. See [`identity.ts`](src/shared/identity.ts) and [`entity-history.ts`](src/shared/entity-history.ts).

Duplicate detection uses name tokens, category, and shared confirmed facts, with candidate limits. It is a review heuristic. The entity UI's conflict detection is also structural: multiple confirmed values for the same key without a current selection. Neither mechanism supplies general semantic reasoning.

## Reads, writes, and failures

The renderer consumes `WorkspaceSnapshot` values with increasing generations so late refreshes can be ignored. Unchanged parses are cached, with ownership and file-type checks on reads. A recursive watcher batches external changes.

Editors autosave after a delay and on lifecycle events. Revision checks detect changes since the editor read the file and expose a conflict choice. Mutation locks coordinate editor saves with relevant archive, identity, link, and module operations. Existing-file replacements use temporary-file/rename writes in the atomic write helper; new records also use exclusive creation.

Multi-file operations use operation-specific checks and rollback paths. There is no general transaction or crash-recovery journal across the directory. For example, accepting a proposal writes its resulting record before updating proposal status. An interruption can leave a partially completed workflow. Revision checks are not historical version storage and do not prevent arbitrary external tools from changing files.

Malformed records appear as workspace issues. Several damaged settings and index files are preserved with a `.corrupt-<id>` suffix before replacement or rebuilding. Other invalid state, such as document-analysis tracking, raises an error requiring repair. Permission errors are surfaced rather than treated as empty data.

User removal sends pages, documents, entities and their own claims, tasks, and events to the operating system Trash through Electron. At workspace open, older user-removal files in Serenity archive and trash folders are migrated there; merge history is excluded. Restoring a user-removed item now means restoring its file through the system file manager. Conversation deletion identifies dependent records, refuses certain cross-source dependencies, then unlinks the selected files. It is permanent and is not an all-or-nothing transaction. See [`tests/archive.test.ts`](tests/archive.test.ts) and [`tests/workspace.test.ts`](tests/workspace.test.ts).

## Retrieval and document flow

Local FTS5 indexes pages, entities, non-retracted claims, extractable documents, and enabled planning records. Text formats are read directly; PDF and DOCX extraction runs in a worker with a timeout. Extraction supplies text, not faithful document structure or reliable headings for those binary formats.

Retrieval uses three paths:

| Path | Computation and data flow |
| --- | --- |
| Local full-text search | Queries the on-device SQLite index. No provider call. |
| Background AI index | Opt-in provider calls generate summaries and terms for changed records. Local term weighting ranks that derived material; this is not an embedding database. |
| On-demand AI search | Sends assembled workspace context to the chosen provider and validates returned matches against supplied records. |

Background document analysis is separately opt-in. It hashes changed extractable documents and invokes the conversation workflow in propose mode, retaining a conversation. It uses workspace context, not a document-only scope. Disabling modules blocks their application writes/context or cancels corresponding background work while retaining files.

The background index builder includes pages, but `rankSemanticIndex` currently returns no page results. Pages remain available to local search and on-demand AI search. Background-index page retrieval remains incomplete.

## Conversation data flow

[`conversation.ts`](src/main/conversation.ts) loads the snapshot, validates settings, saves the user message, extracts eligible documents, and filters context through [`context.ts`](src/main/context.ts). Whole-workspace mode returns all assembled records, including retained conversations and enabled planning records. Selected mode filters by entity IDs and document names, with separate flags for other chats and planning records; pages are excluded.

For smaller inputs, all eligible records are sent. Larger inputs use a catalog of up to 1,200 records and ranked excerpts of up to 9,000 characters within a 180,000-character context budget. A provider can request another permitted record or excerpt for one additional pass. Eligibility does not guarantee discovery or exhaustive reading; the catalog and number of passes are bounded. Excessive catalog size can raise an error.

Each user message records the assembled context references, offsets, lengths, and checksums. Recent conversation text is added separately: up to 15 previous messages, each shortened when longer than 1,200 characters. Narrowing scope does not filter that history. The manifest records Serenity's context assembly, not every byte or possible runtime read.

Responses are parsed into answer text, citations, and proposals. Unstructured output remains answer text without structured proposals. Proposal validation checks shape, IDs, module availability, and applicable scope. Auto-acceptance is governed by [`workflow.ts`](src/shared/workflow.ts): only autonomous mode can apply additions, with separate permissions and review for detected identity ambiguity or new entity categories. Ask and propose both leave additions pending.

Citation validation checks supplied references and searches quote text in the corresponding eligible record. It does not require the quote to occur in the exact transmitted excerpt, verify entailment, or validate proposal source strings. The UI exposes failed checks; it cannot certify factual correctness.

## Provider access

[`providers.ts`](src/main/providers.ts) creates fresh provider sessions/threads for calls. Copilot has an empty available-tool list and rejects permission requests. Codex is configured read-only with approvals and tool network access disabled, using the workspace as its working directory. The model request itself still uses the provider service.

Codex receives no selected-file allowlist and its tools are not explicitly removed. The prompt asks it not to use tools or edit files. The context filter therefore does not enforce a provider filesystem read boundary. The two adapters currently offer different controls. No complete read-isolation or provider-side retention guarantee follows from the activity log.

AI search and background jobs are workspace operations independent of conversation scope. A coherent privacy boundary across adapters, conversation history, and background jobs remains unfinished. Durable knowledge stays in Serenity files, but copies sent to external services are outside Serenity's control.

[`provider-activity.ts`](src/main/provider-activity.ts) records operation references, prompt character count/checksum, timing, and outcome without a second full prompt. Cancellation and failed calls can leave a saved user message and activity record without a completed answer; a call is not a single workspace transaction.

## Composition groundwork

Stable `serenity:kind/id` addresses connect records to presentations. The renderer's resource routing, built-in view registry, and command registry organize navigation and actions. Session state restores open resources and layout; `.serenity/workbench.yaml` configures navigation and shortcuts.

Pages support wikilinks and bounded `serenity-query` YAML blocks, with a maximum result limit of 100. They query registered workspace sources without executing arbitrary code. Home is an authored page. These mechanisms support application composition; third-party plugin loading, a versioned extension API, and an extension trust model are not implemented.

## Verification

Relevant behavioral checks include [`tests/entity-history.test.ts`](tests/entity-history.test.ts), [`tests/identity.test.ts`](tests/identity.test.ts), [`tests/workflow.test.ts`](tests/workflow.test.ts), [`tests/context-scope.test.ts`](tests/context-scope.test.ts), and [`tests/citations.test.ts`](tests/citations.test.ts). They test application behavior, not provider sandbox enforcement or model accuracy. Desktop smoke tests exercise renderer/preload/main integration; CI packages and smoke-tests macOS, Windows, and Linux without live provider turns. Commands and test limitations are in [CONTEXT.md](CONTEXT.md).
