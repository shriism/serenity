# Changelog

Notable user-visible changes are listed newest first. Workspace files remain readable Markdown and YAML; new record types are called out where relevant.

## Unreleased

- AI providers now share one inference interface, so conversations, search, indexing, and document analysis work the same with each. Supported providers are **ChatGPT** (Sign in with ChatGPT, using your ChatGPT plan through OpenAI's Responses API), **GitHub Copilot** (your existing Copilot subscription), and **OpenAI-compatible** servers, including Ollama, LM Studio, vLLM, and the llama.cpp server, with a configurable address, model, and optional API key.
- Answers appear as they are written, and each provider's model can be chosen in Settings. Messages and provider activity record the model that answered when the provider reports it.
- Providers no longer receive tools, file access, or the workspace path; Copilot sessions are deleted after each request.
- OpenAI Codex is no longer offered. Earlier Codex conversations and suggestions keep their attribution. A workspace that used Codex for background AI pauses it until you choose another provider, and a saved Codex API key is removed; use it with the OpenAI-compatible provider's OpenAI setting instead.
- Recheck provider status when Settings regains focus, restart an opted-in background index once its provider is available, and avoid rebuilding the index in response to its own output file.
- Calendar Agenda now shows every upcoming event and open due task across month boundaries.
- Kept one React root during development reloads so a rendering failure shows one recovery view.
- Gave Calendar more space, allowed month items to wrap, and added a readable next-30-days list beneath the grid.
- Moved user-removed workspace records to the operating system Trash and removed the in-app Calendar Trash; preserved merge history inside the workspace.

- Reorganized documentation into a practical introduction, product/design explanation, architecture reference, and development guide. Clarified sourced statements, revisable decisions, AI review, and current implementation limits.

## 2.0.3 — 2026-09-28

- Put **New chat** before **Chat history** in the assistant sidebar and removed the duplicate New chat action from the history menu.
- Removed the short horizontal divider beneath the left sidebar toggle.
- Updated the desktop package version and refreshed the product, architecture, and developer documentation.

## 2.0.2 — 2026-09-28

- Fixed Calendar drag and resize changes being lost during workspace refreshes.
- Corrected titlebar and sidebar dividers around macOS window controls and in full screen; centered the Serenity title.
- Fixed the assistant sidebar toggle receiving clicks in the draggable titlebar.
- Made **New** the primary Documents action and **Import** secondary.

## 2.0.1 — 2026-09-28

- Corrected theme transitions, narrow-window sidebar behavior, tab overflow, and titlebar dividers.
- Added editable Markdown and plain-text documents with autosave and revision checks. Improved page-title and editor keyboard behavior.
- Added Day, Week, Month, and Agenda Calendar views, click-to-edit events, task overlays, and event trash with restoration.
- Added per-workspace shortcut editing, scrollbar and tab-number settings, and workspace-file search with **⌘/Ctrl+O**.
- Added starred chats and chat deletion with dependent-record checks. Replaced the separate mode switch with controls to expand chat and return it to the assistant sidebar.
- Improved live-query editing, empty-pane cleanup, sidebar resize handles, and accessibility details.

## 2.0.0 — 2026-09-28

The desktop interface was rebuilt around titlebar tabs, a left ribbon and explorer, split panes, an assistant sidebar, and full-window chat. The workspace format stayed compatible with 1.x layouts.

- Made Home and other pages editable in a live-preview Markdown editor, with inline titles, `[[wikilinks]]`, task checkboxes, and autosave conflict handling.
- Opened files and application views as tabs. Added a command-backed application menu, new-tab screen, dialogs, right-click menus, and recent-workspace selection.
- Added reviewable assistant suggestions beneath replies, including tasks, events, entities, and sourced facts.
- Added archive actions for pages, documents, and entities; archived files remain readable and can be restored.
- Added resizable sidebars, narrow-window layouts, clear save status, and dismissible error notices.

## 1.1.0 — 2026-09-27

- Moved PDF and DOCX extraction to a worker so large files do not stall editing.
- Added highlighted search excerpts, persistent search panes, and questions scoped to search results.
- Expanded page queries with tables and counts, and added filters for entity timelines.
- Improved document analysis with source-linked suggestions for entities, claims, relationships, tasks, and events.
- Added appearance and view-switch commands, accessibility checks in both themes, and clearer empty states.

## 1.0.0 — 2026-09-27

First desktop release for macOS, Windows, and Linux.

- Added a restorable workbench with split panes, draggable tabs, per-resource presentations, configurable commands, and workspace navigation.
- Added authored Markdown pages, wikilinks and backlinks, sourced claims, entity timelines and connections, reversible merge and distinct-identity decisions, Review, Knowledge graph, Calendar, Tasks, and Activity. Distinct-identity decisions introduced a versioned YAML record type.
- Added Copilot and Codex conversations with read scopes, focused-pane context, source disclosure, citation checks, and reviewable proposals.
- Added revision-checked writes, corruption recovery, background full-text indexing, large-workspace performance checks, and per-pane error containment.
- Added keyboard navigation, contrast and focus improvements, and an axe-core desktop smoke-test gate.
