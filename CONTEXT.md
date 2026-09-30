# Development

Use this guide to run, test, and package Serenity. For a technical overview, read [Architecture](ARCHITECTURE.md); for the reasoning behind the product, read [Product and design](SERENITY.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `src/main/` | Workspace I/O, extraction, indexing, and Electron lifecycle. |
| `src/main/ai/` | The model provider interface, each provider's authentication and transport, and credential storage. |
| `src/preload/` | Typed application bridge. |
| `src/renderer/` | Editors, resource views, workbench, and assistant interface. |
| `src/shared/` | Types and pure logic for identity, provenance, workflows, queries, and presentation. |
| `tests/` | Unit/integration tests, desktop smoke, performance, and screenshot helpers. |
| `assets/`, `scripts/` | Artwork and build helpers. |
| `.github/workflows/` | Cross-platform checks, packaging, and packaged smoke tests. |

## Run and verify

Use Node.js 24 or newer:

```sh
git clone https://github.com/shriism/serenity.git
cd serenity
npm ci
npm run dev
```

Choose a workspace folder in the app, or supply `--workspace=/path/to/folder` when launching the executable. Unset `ELECTRON_RUN_AS_NODE` if the shell exports it. Local work requires no provider sign-in; live AI requests require supported provider authentication.

```sh
npm run typecheck
npm test
npm run build
```

Desktop integration and performance checks require a graphical session:

```sh
npm run smoke:desktop
npm run perf:desktop
```

These use temporary workspaces and profiles. Smoke tests include both themes and an axe-core accessibility check. Performance tests measure a large synthetic workspace.

| Environment variable | Purpose |
| --- | --- |
| `SERENITY_SMOKE_VISIBLE=1` | Display the test window. |
| `SERENITY_SMOKE_EXECUTABLE` | Test a packaged executable. |
| `SERENITY_SMOKE_WINDOW=900x640` | Run a small-window pass. |
| `SERENITY_SMOKE_PROVIDER=chatgpt`, `copilot`, or `ollama` | Opt into a live turn with a provider already set up in the app profile; hosted providers use quota. |

## Package

Package for the current OS with `npm run dist`. Platform scripts are `npm run dist:mac`, `npm run dist:win`, and `npm run dist:linux`, subject to available tooling. CI runs type checks, tests, packaging, and packaged smoke checks on macOS, Windows, and Linux. Live provider requests are excluded. CI disables signing identity discovery; signing, notarization, and an automatic update channel require separate release work.

## Making changes

Inspect the diff and run checks appropriate to the change. Record user-visible behavior changes in [CHANGELOG.md](CHANGELOG.md). For documentation changes, verify claims against the relevant source and check links and commands.

Before making durable changes to knowledge representation, memory, autonomy, or extension trust, explain the problem, viable approaches, tradeoffs, and a recommendation to the owner. [Product and design](SERENITY.md#open-questions-and-direction) records unresolved product questions; the architecture document records current implementation limits.
