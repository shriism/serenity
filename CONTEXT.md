# Project context

Serenity is a local-first desktop knowledge workspace with provider-backed AI assistance. The current published version is **2.0.2** (2026-09-28). It has macOS Apple silicon, Windows x64, and Linux x64 artifacts, with SHA-256 checksums. All three packaged builds passed CI smoke tests; live Copilot and Codex turns were verified from the packaged macOS application. Builds are unsigned.

This is a working project snapshot. [README.md](README.md) covers installation and use, [SERENITY.md](SERENITY.md) records product decisions, [ARCHITECTURE.md](ARCHITECTURE.md) describes system boundaries, and [CHANGELOG.md](CHANGELOG.md) records user-visible changes. Read the current code and tests before changing behavior.

## Shipped scope

- **Workspaces:** one chosen folder at a time, readable Markdown and YAML records, copied document imports, recent-folder selection, external-edit detection, revision-checked saves, and recoverable settings and indexes.
- **Workbench:** authored pages and Home, tabs and resizable split panes, resource-specific views, a configurable ribbon and shortcuts, local search, a search pane, light/dark/system appearance, and narrow-window layouts.
- **Knowledge:** entities with sourced claim history, corrections and current-answer decisions, reversible merges and distinct-identity records, wikilinks, duplicate review, Knowledge graph, and Activity.
- **Planning and documents:** optional internal Calendar and Tasks, document extraction and provenance, review beside source documents, and optional AI document analysis.
- **Assistant:** separate Copilot and Codex providers, sidebar and full-window chat, conversation retention controls, read scope, disclosed context, checked citations, reviewable proposals, per-conversation autonomy, and optional semantic indexing.
- **Quality:** unit tests, desktop smoke and accessibility checks, performance budgets, and packaged CI checks on macOS, Windows, and Linux.

The 2.0.2 release fixed Calendar drag and resize persistence, macOS titlebar dividers, the assistant sidebar toggle, and Documents button emphasis. See the changelog for earlier releases and changes after 2.0.2.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/main/` | Electron lifecycle, validated workspace operations, search, extraction, providers, and credentials. |
| `src/preload/` | Typed IPC bridge. |
| `src/renderer/` | React workbench, resource views, editors, and assistant UI. |
| `src/shared/` | Pure data types, resource addressing, queries, layout, provenance, and workflow rules. |
| `tests/` | Unit, desktop smoke, performance, and screenshot checks. |
| `assets/`, `scripts/` | App artwork and build helpers. |
| `.github/workflows/` | Cross-platform checks and release automation. |

A resource URI identifies a page, entity, document, or view independently of its current filename or presentation. Commands supply stable action IDs to menus, search, shortcuts, and workspace navigation. Adding a built-in view or module requires code, validation, and a typed main-process API; workspace YAML is configuration, not executable plugin code.

## Next decisions

The shipped desktop scope is complete. Near-term work is driven by real use: interface polish, recovery and migration checks on older or larger workspaces, document and retrieval ergonomics, and packaging reliability. PDF and DOCX extraction does not provide reliable headings, so those formats have no inferred outline today.

Signing, notarization, and automatic updates require certificates and an update-channel decision. Installable plugins require a versioned contribution API and an explicit trust model. External actions, external calendar sync, cloud or device sync, local models, mobile access, and simultaneous workspaces are future goals; none should be described as shipped behavior. For durable changes to knowledge representation, ontology, memory, autonomy, or extension trust, use the decision principles in [SERENITY.md](SERENITY.md).

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

Desktop smoke and performance checks need a graphical session. They use `--background` and a temporary profile. `SERENITY_SMOKE_VISIBLE=1` shows the test window; `SERENITY_SMOKE_EXECUTABLE` selects a packaged app. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` opts into a live authenticated turn and uses provider quota. Unset `ELECTRON_RUN_AS_NODE` if the shell exports it. A small-window pass can be run with `SERENITY_SMOKE_WINDOW=900x640 npm run smoke:desktop`.

Before committing, inspect the diff and run the checks relevant to the change. CI verifies the pushed commit and packages each platform. Record user-visible changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
