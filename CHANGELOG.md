# Changelog

Serenity's notable changes, newest first. The workspace format stays readable Markdown and YAML; entries note anything that adds to it.

## Unreleased

## 2.0.2 (2026-09-28)

- Calendar drag and resize gestures survive workspace refreshes without silently discarding changes.
- Navigation dividers start below the titlebar, clear of macOS window controls; the welcome screen has no stray titlebar line. In full screen, the ribbon divider extends through the titlebar whether the sidebar is open or closed. Serenity is centered as the application title.
- The assistant sidebar toggle receives native mouse clicks instead of being intercepted by the draggable titlebar.
- Documents uses the accent color for New and the neutral style for Import.

## 2.0.1 (2026-09-28)

- Theme changes apply text and background colors together, avoiding low-contrast frames while switching appearance.

- Escape leaves page, note, and text-document editing; Enter in a page title moves into its body, while Escape cancels a title change.
- Scrollbars can be hidden without leaving a gutter, or shown again in Settings. The editor and tab-number shortcuts have their own switches.
- Command shortcuts, including the tab shortcuts, can be changed or cleared per workspace in Settings.
- Markdown and plain-text documents can be created and edited in place with autosave and revision checks.
- Arrow keys can move into a live query to edit its YAML directly; clicking the preview's open space does the same without a separate Edit button.
- Calendar now offers Day, Week, Month, and Agenda in that order, with click-to-edit events and tasks shown beside events. A + beside Agenda opens the event form in a popup; deleting an event moves its YAML file to `trash/calendar/` for restoration.
- ⌘O / Ctrl+O searches openable files in the current workspace, and ⌘⇧O / Ctrl+Shift+O opens another workspace. Both commands can be rebound in Settings.
- Empty split panes close when their last tab is closed or moved. Sidebar resize handles no longer cover the composer or intercept typing.
- Text fields no longer show manual resize grips, and the title-bar divider continues across the window controls.
- Chat rows have a star control and a Starred section. Right-click a chat to delete its transcript, proposals, identifiable accepted records, and linked Activity entries from the workspace.
- The assistant expand control now also returns a full-window chat to the sidebar. The separate Workspace/Chat buttons are gone, and the sidebar toggle moves to the far left in macOS full screen.
- The assistant sidebar slides beneath one fixed toggle; the title-bar divider aligns with the ribbon in full screen. Calendar puts Today before its date arrows.
- The sidebar title bar names Serenity, its edge dividers run continuously into the window chrome, and crowded tabs scroll horizontally with a mouse wheel or trackpad. New tab stays beside the pane menu while the tabs scroll.

## 2.0.0 (2026-09-28)

A rebuilt interface that looks and behaves like a native desktop app. The workspace format is unchanged, and layouts saved by 1.x are restored.

### Window and navigation

- Content reaches the title bar. Tabs sit beside the macOS traffic lights; on Windows and Linux they sit under the system window controls, which follow the app's appearance.
- A switch at the top left moves between **Workspace** and **Chat** modes.
  - Workspace mode has a ribbon of views and a file tree of pages, entities (grouped by type), and documents on the left, tabbed panes in the center, and the assistant on the right.
  - Chat mode is a full-window conversation with your conversations listed beside it.
- The switch between Workspace and Chat is labeled, and Chat mode has a New chat button beside the conversation title.
- Serenity remembers the workspaces you open. On launch it offers to reopen the last one, lists other recent ones, and the workspace menu at the bottom of the sidebar can switch to them. The list is kept in the app's own settings, not in any workspace, and only folders you chose before can be reopened from it.
- A new app icon: an S traced through three connected points.
- The assistant has a single control to show or hide it (**⌘J** / **Ctrl+J**), where there used to be two.
- Calendar, Tasks, Review, Documents, Knowledge, Activity, and Search open as tabs like any file. An empty tab offers quick actions. Closing a tab shows the one beside it.
- Settings is a dialog with sections, and new entities are named in a short dialog that points out possible duplicates.
- An application menu lists every action with its shortcut. New tab (**⌘T**), Close tab (**⌘W**, which no longer closes the window), Next and Previous tab (**⌘⇧]** / **⌘⇧[**), Settings (**⌘,**), and New page (**⌘N**) are new. The menu no longer includes developer tools in release builds.
- Pages, entities, and documents can be moved to the archive from their right-click, tab, or pane menu; nothing is deleted. Pages go to `archive/pages/`, documents to `archive/documents/`, and an entity with the facts about it to `archive/removed/`, where other notes still show its name. An entity that others were merged into, and the Home page, cannot be archived.
- Changes the assistant suggests in a conversation (tasks, events, entities, facts) appear under its answer with Accept and Dismiss, as well as in Review. The assistant knows today's date, so "add a task for tomorrow" gets the right day, and it proposes what you ask it to create rather than only describing it.
- Segmented switches (List/Board, Profile/Timeline, and others) show the selected option clearly, and resize handles no longer stay highlighted after a drag.
- Pages and entities say **Saving…** and **Saved** as edits reach disk.
- Files in the sidebar and tabs have right-click menus: open in the next pane, copy a `[[link]]`, close other tabs or tabs to the right, and move or split a tab.
- The sidebars can be resized and float over the content in narrow windows. Pane content adapts to the pane's width.
- Errors appear as dismissible notifications, and unreadable files are listed from the sidebar.

### Writing

- Pages and entity notes are always editable, in a live-preview Markdown editor. Formatting shows as it reads, and syntax appears only on the line you are editing.
  - Links and `[[wikilinks]]` open on click; task checkboxes tick in place.
  - **⌘B** and **⌘I** toggle bold and italic.
  - Live `serenity-query` lists render inside the page.
- Edits are saved as you type, with no Save button. If a file changes on disk while you are editing it, Serenity asks which version to keep.
- Titles are edited in place. Renaming a page, like an entity, offers to update the links that name it.
- An entity shows its type as a property and its sourced facts as compact rows, with actions in a menu.
- New workspaces' Home no longer repeats its title as a large heading.

### Details

- A system font, neutral greys, and one accent colour replace the display typefaces, and every view has a plain title row.
- Search excerpts no longer show Markdown syntax, and live lists show linked entities by name rather than by ID.

## 1.1.0 (2026-09-27)

Improvements after the first desktop release; no changes to the workspace format.

- PDF and DOCX text is extracted in a background worker, so indexing or reading a large document no longer stalls saving and other actions.
- Search results show a snippet of where the words matched, with the matches highlighted.
- Page queries can show a table or a count (`display: table` / `display: count`), and lists say how many more matched.
- Empty live lists say how things get there, and the new-workspace Home shows the `[[wikilink]]` syntax literally.
- Analyzing a document asks for reviewable structure: entities (checked against existing ones), sourced facts and relationships, a task per dated deliverable, and an event per scheduled session, without inventing unstated details. Suggestions citing a location (`syllabus.pdf, p. 2`) are grouped and linked with their document.
- A document's Knowledge from it view offers **Suggest connections between these**: a conversation limited to the document and the entities recorded from it, asking for sourced relationships among them.
- Appearance (dark, light, match system) and **Switch view of this tab** are commands, so they can be found in search and given shortcuts.
- An entity's Timeline can be narrowed to facts, corrections, decisions, merges, AI suggestions, mentions, or plans.
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
