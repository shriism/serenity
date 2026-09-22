# Serenity

Serenity is a cross-platform Electron application for building a personal knowledge workspace with AI assistance. Product principles and agreed decisions are in [SERENITY.md](SERENITY.md); implementation boundaries and module extension guidance are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

Install Node.js 22 or newer, then:

```sh
npm install
npm run dev
```

Choose an existing directory or create one when the application opens. Serenity writes `entities/`, `claims/`, `conversations/`, `proposals/`, `documents/`, `calendar/`, `tasks/`, and `archive/` there. The rebuildable SQLite full-text index is in `.serenity/index.sqlite`; module settings are in `.serenity/modules.yaml`. The selected directory is the knowledge source of truth; provider credentials are stored in the operating system's secure storage outside it. You can edit the Markdown and YAML files in a text editor; Serenity refreshes when files change and refuses to overwrite an entity, calendar event, or task modified since you began editing it.

To check the project:

```sh
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

The desktop smoke test launches Electron and checks that the window and secure preload API start; run it on a machine with a graphical desktop.

To package for the current OS use `npm run dist`. Platform-specific commands are `npm run dist:mac`, `npm run dist:win`, and `npm run dist:linux` (cross-building may require platform-specific tooling or a machine running the target OS). Unsigned macOS builds may require manual permission to open.

## AI connections

The conversation view can switch between GitHub Copilot, OpenAI Codex, and Claude Agent SDK. Connect a supported provider account using its native tooling, or enter a credential under **Connections**. Claude Agent SDK in a third-party app requires an Anthropic API key; it cannot reuse a claude.ai login. The SDKs use provider-backed services; no local model is required. The chosen workflow autonomy setting controls proposed claims: ask first, review proposals, or auto-save claims from that conversation. Provider agent tools are disabled or set read-only: knowledge updates are made through Serenity's own claim workflow.

The desktop app also lets you browse and edit entities, link them through sourced claims, archive and merge duplicates without losing history, search text and relationships, ask a provider to search semantically on demand, import source files, analyze text/PDF/DOCX documents through conversation, review AI suggestions for claims, entities, tasks, and events, and control whether conversations are retained. Retracted claims stay in history but are excluded from current search. Its internal calendar and task modules connect records to existing entities and can be disabled without deleting their files. An optional background AI indexing module builds derived semantic summaries and topic terms under `.serenity/semantic-index.yaml`; those terms can be searched locally using sparse vector similarity without another provider call. An independent opt-in document analysis module analyzes newly added or changed documents and drafts proposals. Both send workspace content to the selected provider when enabled, so both are off by default.

## Current limitations

This is an actively developed application, not yet the complete product described in SERENITY.md. Neural embedding retrieval, fully automated entity resolution, more granular autonomy controls, cloud sync, local models, and mobile apps are not implemented. Calendar and tasks are internal only; no external calendar sync is planned. Live Copilot and Codex SDK smoke tests succeeded on macOS; Claude needs an Anthropic API key for a live test, and packaged SDK operation still requires end-to-end testing on all target operating systems. Large workspaces currently fail with an explicit context-limit error instead of silently omitting files from AI requests.
