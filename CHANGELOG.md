# Changelog

Serenity's notable changes, newest first. The workspace format stays readable Markdown and YAML; entries note anything that adds to it.

## Unreleased

- Search results show a snippet of where the words matched, with the matches highlighted.
- Page queries can show a table or a count (`display: table` / `display: count`), and lists say how many more matched.
- Empty live lists say how things get there, and the new-workspace Home shows the `[[wikilink]]` syntax literally.
- **Search in a pane** (⌘⇧F / Ctrl+Shift+F, or **Keep results in a pane** from search) keeps results open with highlighted excerpts; results open in the neighboring pane.
- **Ask about these results** in search starts a conversation that may read only the entities and documents the search found.
- Accessibility checks cover every main view in both themes; links show a keyboard focus ring.
- The Windows installer is named `Serenity-Setup-<version>.exe`.

## 1.0.0 (2026-09-27): first desktop release

The desktop workbench for macOS, Windows, and Linux, built on the September 2026 foundation (workspace pages, resources, commands, and view contributions). macOS builds are not yet signed or notarized, so macOS asks for permission the first time they open.

### Workbench

- Obsidian-style panes: split any pane right or down, resize with dividers (pointer or keyboard), drag tabs between panes or onto an edge to split, reorder tabs, and move focus by direction. Closing a pane never touches files. The arrangement, sizes, and each tab's view are restored with the workspace, and narrow windows show one pane at a time.
- Resources open as tabs through one routing contract; pages other than Home are tabs too.
- Several views of one resource, chosen per tab: an entity's Profile, Timeline, and Connections; a page's authored text and its Links; a document's Text, Outline (Markdown), and Knowledge from it; Tasks as a list or due-date board; Calendar as a month or agenda.
- Commands have one registry for metadata, availability, and dispatch. Workspaces can rebind shortcuts in `.serenity/workbench.yaml`; Settings lists every command and its shortcut.

### Knowledge

- `[[Wikilinks]]` between pages, entities, and documents, with suggestions while typing, backlinks, clear marking of ambiguous or missing names, and an offer to update links when an entity is renamed.
- Entity timelines keep corrections, current-answer decisions, merges, and AI suggestions beside what they changed; Connections shows relationships and mentions.
- Possible duplicate entities are suggested with their evidence and can be compared side by side, merged reversibly, or marked distinct. Distinct decisions are recorded in the workspace and can be undone. *Adds a workspace record type for distinct-identity decisions.*
- Review groups AI suggestions by source and shows a document's suggestions beside its text; each document lists the knowledge recorded from it.
- The Knowledge library filters by name and type and can be shown as a graph. Activity is filterable, grouped by day, and linked to its records.
- Page queries can select by document source and list recent activity.

### Assistant

- Answers cite the records they rely on. Each citation is checked against what was actually sent and whether its quote appears in the record; unverified citations are flagged.
- The focused pane is the assistant's primary context and other visible panes add context, always within the conversation's read scope. Read scope is chosen with a searchable picker.

### Reliability and performance

- Snapshots reuse unchanged files and are ordered, so slower replies never overwrite newer state; a 2,000-entity, 8,000-claim workspace refreshes in about 140 ms.
- Revision-checked writes are serialized per file, and merges, archives, identity decisions, wikilink updates, and module switches coordinate with editor saves so concurrent edits cannot silently overwrite one another.
- Damaged session, settings, semantic-index, and document-analysis files are preserved beside a fresh start instead of being overwritten.
- A view that fails to render is contained to its pane; a crashed window reloads into the same workspace, and a window that keeps failing is not reloaded in a loop.
- Large workspaces open and stay responsive: the file watcher uses one recursive watch instead of a handle per file (a workspace of about ten thousand files previously could not open its window), wikilinks resolve through a title index, and the search index is rebuilt in the background. `npm run perf:desktop` checks launch, navigation, typing, and search against budgets on a 2,000-entity workspace.

### Accessibility

- Text meets 4.5:1 contrast in both themes; keyboard focus survives closing tabs and panes; view switchers and dividers are keyboard operable. The desktop smoke test fails on serious or critical axe-core violations.

### Other

- Web and email links in pages and notes open in the system browser; only `http`, `https`, and `mailto` are accepted.
- Settings shows the app and runtime versions for bug reports.
- `--background` runs the app without a window or focus, for automated checks.
