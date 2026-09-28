# Serenity

Serenity is a desktop knowledge workspace for notes, documents, people, projects, plans, and AI-assisted research. You choose a folder for your data. Authored knowledge remains readable Markdown and YAML, while Serenity connects records, preserves their sources, and helps you work with them.

[Download Serenity](https://github.com/shriism/serenity/releases/latest) · [Product principles](SERENITY.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Project context](CONTEXT.md)

## Get started

Download the macOS Apple silicon, Windows x64, or Linux x64 build from the latest release. The release includes SHA-256 checksums. Builds are currently unsigned, so your operating system may request approval on first launch.

Choose an existing folder or create a workspace when Serenity opens. You can also supply `--workspace=/path/to/folder` at launch. The workspace can be backed up or inspected with ordinary file tools. Provider sign-in is needed for AI requests; local browsing, editing, and search work without it.

## What you can do

**Organize connected knowledge.** Write pages and entity notes in Markdown, link them by name, and browse relationships among people, places, projects, and concepts. Entity types and relationship names are flexible. A claim records its source and status; corrections and competing claims remain visible. You can select a current answer, compare possible duplicate entities, reverse a merge, or record that two similar identities are distinct.

**Work with documents.** Import files as copies into your workspace. Serenity searches text, Markdown, CSV, JSON, YAML, PDF, and DOCX, while other file types remain available in their native applications. A document can be traced to the claims, entities, plans, and suggestions attributed to it. The review workflow lets you compare an AI suggestion with its source before accepting it.

**Find and reuse information.** Local full-text search indexes workspace records and provides relevant excerpts. Pages can include `[[wikilinks]]` and bounded `serenity-query` blocks that show live lists, tables, or counts from workspace data. These queries cannot execute code or read outside the workspace. Optional AI-assisted retrieval and background indexing extend search when enabled.

**Plan work.** Internal Calendar and Tasks records can link to the same entities and sources as the rest of your knowledge. Their modules can be disabled without deleting their files. External calendar sync is not built in.

**Collaborate with an assistant.** Choose GitHub Copilot or OpenAI Codex. Each conversation has a read scope and change permissions; the selected workspace is the default read boundary, and you can restrict it further. Serenity records which resources were sent to the provider, checks cited sources, and keeps suggested changes reviewable. Automatic saving is limited to the record types you explicitly permit. Optional document analysis and semantic indexing are off by default because they may send workspace content to a provider.

## Data and privacy

Workspace records live in the folder you select: pages, entities, claims, decisions, documents, conversations, proposals, tasks, events, activity, and archives. `.serenity/` holds workspace settings and derived indexes. The SQLite search index can be rebuilt from the readable records. Imports are copies; symlinked files and directories are excluded from workspace content.

Edits made outside Serenity are detected. Saves use revisions so a newer disk change is not silently overwritten. Credentials stay outside the workspace in OS-protected storage when available or in current-session memory. Provider activity records operations and referenced resources without storing a second copy of the prompt.

The application does not provide its own cloud sync, local AI model, mobile client, or installable plugin system. See [SERENITY.md](SERENITY.md) for enduring product boundaries and [CONTEXT.md](CONTEXT.md) for future work.

## Develop

Node.js 24 or newer is required.

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run smoke:desktop` exercises the application with a temporary workspace and profile. `npm run perf:desktop` checks a large synthetic workspace. Both need a graphical desktop. Set `SERENITY_SMOKE_VISIBLE=1` to display the test window or `SERENITY_SMOKE_EXECUTABLE` to test a packaged executable. `SERENITY_SMOKE_PROVIDER=copilot` or `codex` opts into an authenticated live turn and uses provider quota. Unset `ELECTRON_RUN_AS_NODE` if your terminal exports it.

Run `npm run dist` to package for the current OS. Platform-specific scripts are `npm run dist:mac`, `npm run dist:win`, and `npm run dist:linux`, subject to available tooling. CI typechecks, tests, packages, and smoke-tests the supported desktop platforms. [ARCHITECTURE.md](ARCHITECTURE.md) explains the runtime and storage boundaries.
