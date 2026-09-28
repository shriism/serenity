# Project context

Serenity is a local-first desktop knowledge workspace with provider-backed AI assistance. This document records the current project scope and development direction. For use, see [README.md](README.md); for product decisions, see [SERENITY.md](SERENITY.md); for implementation boundaries, see [ARCHITECTURE.md](ARCHITECTURE.md). Dated release history belongs in [CHANGELOG.md](CHANGELOG.md).

## Current capabilities

- **Workspaces:** one selected folder at a time, readable Markdown and YAML records, copied document imports, external-edit detection, revision-checked saves, recoverable settings, and rebuildable indexes.
- **Knowledge:** authored pages, flexible entities, sourced claims, corrections, current-answer decisions, reversible merges, explicit distinct-identity judgments, links, relationship exploration, and provenance-aware activity.
- **Documents and retrieval:** text extraction, source-linked knowledge, local full-text search, bounded live queries, optional AI-assisted retrieval, and opt-in document analysis.
- **Planning:** internal tasks and events linked to entities and sources; modules can be disabled without removing their data.
- **Assistant:** separate Copilot and Codex integrations, retained conversations, per-conversation read scope and autonomy, disclosed context, checked citations, and reviewable suggestions.
- **Desktop quality:** restorable multi-pane work, configurable commands and shortcuts, responsive layouts, accessibility checks, performance budgets, and packaged CI validation on macOS, Windows, and Linux.

Builds are currently unsigned. Provider authentication is needed for AI requests, while local workspace capabilities remain available without it. The current release and downloads are on [GitHub Releases](https://github.com/shriism/serenity/releases/latest).

## Repository map

| Path | Purpose |
| --- | --- |
| `src/main/` | Electron lifecycle, validated workspace operations, search, extraction, providers, and credentials. |
| `src/preload/` | Typed IPC bridge. |
| `src/renderer/` | Desktop interface, editors, resource views, and assistant. |
| `src/shared/` | Pure types and logic for resource addressing, queries, layout, provenance, and workflows. |
| `tests/` | Unit, desktop smoke, performance, and screenshot checks. |
| `assets/`, `scripts/` | Artwork and build helpers. |
| `.github/workflows/` | Cross-platform checks and packaging. |

Resource URIs identify records independently of filenames or presentation. Commands give actions stable IDs across the application. Workspace YAML configures existing capabilities; adding executable views or modules requires code, validation, and a typed main-process API.

## Development direction

Near-term work follows real use: improve editing and retrieval, exercise recovery and migrations against older and larger workspaces, and maintain packaging reliability. PDF and DOCX extraction does not currently preserve reliable headings, so those formats do not receive an inferred outline.

Signing, notarization, and automatic updates require certificates and an update-channel decision. Installable plugins require a versioned contribution API and an explicit trust model. External actions, external calendar sync, cloud or device sync, local models, mobile access, and simultaneous workspaces need separate designs. Before making a durable change to knowledge representation, ontology, memory, autonomy, or extension trust, use the decision principles in [SERENITY.md](SERENITY.md).

## Development workflow

Use Node.js 24 or newer:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run smoke:desktop
npm run perf:desktop
npm run dist
```

Desktop smoke and performance checks need a graphical session. They use a temporary profile and can run without taking focus. `SERENITY_SMOKE_VISIBLE=1` displays the test window; `SERENITY_SMOKE_EXECUTABLE` selects a packaged app. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` enables a live authenticated turn and uses provider quota. Unset `ELECTRON_RUN_AS_NODE` if the shell exports it. A small-window pass can be run with `SERENITY_SMOKE_WINDOW=900x640 npm run smoke:desktop`.

Inspect the diff and run relevant checks before committing. CI verifies pushed commits. Record user-visible changes in [CHANGELOG.md](CHANGELOG.md).
