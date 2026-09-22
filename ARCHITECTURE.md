# Serenity architecture

## Runtime boundaries

- **Renderer (`src/renderer/`)** presents the workspace. It has no Node.js filesystem access or direct provider credentials.
- **Preload (`src/preload/`)** exposes a deliberately small, typed API through Electron's context bridge.
- **Main process (`src/main/`)** chooses the workspace, validates edits, loads files, indexes content, and runs AI SDKs. Provider credentials live in OS-protected storage outside the workspace.
- **Shared (`src/shared/`)** defines record types and the module registry.

Agent SDK tools are disabled or read-only. Providers return proposed knowledge; Serenity performs writes after the selected workflow's review or autonomy rule. Conversations, proposal decisions, claim sources, and merge history are independent of provider-private sessions.

## Source of truth

The chosen directory contains Markdown entity files, YAML claims and conversations, imported documents, and YAML data for the optional calendar and task modules. `.serenity/index.sqlite` is a rebuildable text index. `.serenity/semantic-index.yaml` is a rebuildable AI-generated summary and topic-term index, enabled only by an explicit module setting; sparse topic-vector similarity can be computed locally from it. An archived merge preserves the duplicate's Markdown under `archive/entities/` and records its redirect under `archive/merges/`; claims remain in their original files and resolve through that redirect on read.

Record IDs are stable UUIDs. Types and relationship names are ordinary user-chosen strings, not a fixed ontology. Sourced claims keep confirmations, conflicts, and retractions distinct. A stale editor save fails rather than silently replacing an entity, event, task, or conversation changed on disk.

## Modules

The registry in `src/shared/modules.ts` describes disableable modules. The workspace records their switches in `.serenity/modules.yaml`. A disabled module retains its files but does not expose its view, accept new writes, or send its records to AI. Calendar and tasks link to existing entities by ID rather than keeping duplicate copies of people and projects.

To add a built-in module, register its ID and description, define its on-disk records and validation, provide main-process operations through the typed preload API, and add its view. Keep optional modules separate from the core entity/claim source of truth. Module data must remain intact when the module is disabled. External plugin installation is not yet implemented.

## Development verification

`npm test` checks storage invariants and module behavior; `npm run smoke:desktop` boots Electron and verifies the renderer/preload boundary. GitHub Actions typechecks, tests, and packages on macOS, Windows, and Linux. Live provider calls require provider-specific credentials and are not made in CI.
