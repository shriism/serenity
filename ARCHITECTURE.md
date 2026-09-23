# Serenity architecture

## Runtime boundaries

- **Renderer (`src/renderer/`)** presents the workspace. It has no Node.js filesystem access or direct provider credentials.
- **Preload (`src/preload/`)** exposes a deliberately small, typed API through Electron's context bridge.
- **Main process (`src/main/`)** chooses the workspace, validates edits, loads files, indexes content, and runs AI SDKs. Provider credentials live in OS-protected storage outside the workspace.
- **Shared (`src/shared/`)** defines record types and the module registry.

Agent SDK tools are disabled or read-only. Providers return proposed knowledge; Serenity performs writes after the selected workflow's review or autonomy rule. Conversations, proposal decisions, claim sources, and merge history are independent of provider-private sessions. Every provider request writes a record under `activity/` with its operation, provider, referenced workspace IDs, prompt size/checksum, and outcome; raw prompts and credentials are not duplicated there.

Autonomy and read scope are stored with each conversation. The default autonomous permission set allows claims only; entity, task, and event writes can be enabled independently for that workflow. Even when entity writes are enabled, creating a new category or resolving a potentially ambiguous identity remains a review action. The default read scope is the full chosen workspace. In selected mode, only chosen entities and their claims, chosen documents, and specifically allowed conversation/module records are eligible for transmission. Selection is enforced when assembling context and again when accepting proposed writes to existing entities.

When a workspace does not fit a provider request, the knowledge engine retrieves from its full local index, sends an explicit catalog and relevant excerpts, and can supply a requested second excerpt. Each conversation message records the references, byte counts, excerpt offsets, and checksums sent to the provider. Retrieval selects context for transmission; it does not change which workspace files are available to the human or to later AI retrieval.

## Source of truth

The chosen directory contains Markdown entity files, YAML claims and conversations, imported documents, and YAML data for the optional calendar and task modules. `.serenity/index.sqlite` is a rebuildable text index. `.serenity/semantic-index.yaml` is a rebuildable AI-generated summary and topic-term index, enabled only by an explicit module setting; sparse topic-vector similarity can be computed locally from it. An archived merge preserves the duplicate's Markdown under `archive/entities/` and records its redirect under `archive/merges/`; claims remain in their original files and resolve through that redirect on read.

Record IDs are stable UUIDs. Types and relationship names are ordinary user-chosen strings, not a fixed ontology. Sourced claims keep confirmations, conflicts, and retractions distinct. Current-answer choices are append-only records under `resolutions/`, so selecting or undoing a correction does not rewrite its original claims. A stale editor save fails rather than silently replacing an entity, event, task, or conversation changed on disk.

## Modules

The registry in `src/shared/modules.ts` describes disableable modules. The workspace records their switches in `.serenity/modules.yaml`. A disabled module retains its files but does not expose its view, accept new writes, or send its records to AI. Calendar and tasks link to existing entities by ID rather than keeping duplicate copies of people and projects.

To add a built-in module, register its ID and description, define its on-disk records and validation, provide main-process operations through the typed preload API, and add its view. Keep optional modules separate from the core entity/claim source of truth. Module data must remain intact when the module is disabled. External plugin installation is not yet implemented.

## Development verification

`npm test` checks storage invariants and module behavior; `npm run smoke:desktop` boots Electron with an explicitly chosen temporary workspace and exercises the renderer/preload/main-process path. The smoke test can also target a packaged executable and, with a configured account, run a live provider turn. GitHub Actions typechecks, tests, and packages on macOS, Windows, and Linux. Live provider calls require provider-specific credentials and are not made in CI.
