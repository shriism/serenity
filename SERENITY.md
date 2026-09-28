# Serenity: product principles

Serenity is a personal knowledge workspace in which people and AI work with the same inspectable body of information. It connects notes, documents, people, claims, tasks, events, and conversations without making a provider transcript the authority for what is true. The person owns the meaning of their knowledge, decides how it is organized, and can correct or remove it.

This document records enduring product decisions. [README.md](README.md) explains the current application; [ARCHITECTURE.md](ARCHITECTURE.md) describes its implementation; [CONTEXT.md](CONTEXT.md) separates shipped work from future goals.

## Ownership and representation

The person chooses a visible on-device folder when opening Serenity. Authored pages and entity narratives are Markdown with YAML frontmatter; structured records, including claims and decisions, are YAML. Imported documents are copied into that folder. These files remain readable and editable outside Serenity. SQLite and generated semantic data are rebuildable indexes, never a hidden knowledge store. Credentials stay outside the workspace.

Entities have stable identifiers. Their types, categories, and relationships can grow with the person's needs instead of following a fixed universal ontology. New categories require human approval. Each factual claim carries its subject, content, source, and status; AI inference and unconfirmed proposals are distinguishable from confirmed knowledge. Corrections, contradictions, retractions, and current-answer decisions preserve earlier evidence. A decision about the current answer can be reversed.

Potential duplicate entities are compared using evidence, not merged solely by name. A merge archives the duplicate and preserves its history and redirects. The person can undo a merge or explicitly record that two entities are distinct. Ambiguous identity always goes to review; suggested information can be attached to an existing entity or used to create a new one.

## The assistant's role

Serenity offers separate GitHub Copilot and OpenAI Codex integrations. The person chooses a provider; knowledge, permissions, provenance, and review belong to Serenity. Provider-specific authentication and private sessions do not define workspace truth. A conversation can continue visibly when providers change, with each message attributed to its provider; private session state does not transfer. AI execution uses provider services today, while the application and knowledge files run locally. Local models are a future option.

The selected workspace is the default read boundary. A conversation may narrow its scope to chosen resources or separately permit other conversations, calendar, and tasks. Full workspace eligibility does not mean every file is sent with every request: Serenity retrieves relevant material and discloses what was transmitted. The focused pane supplies primary context; other visible panes may add context within the same permission boundary. Answers should cite inspectable sources, and unverifiable citations should be marked.

Every workflow begins in read-and-propose mode. People can choose ask-first or bounded autonomous behavior per conversation and may change permissions later. Switching to autonomous mode initially permits automatic saving of sourced claims only; entity creation, tasks, and events require separate grants. New ontology categories and uncertain identity remain review decisions. A proposal-and-confirmation path must always be available. Provider tools may not bypass Serenity's validation or write directly to workspace files. Actions and provider activity remain inspectable without storing another copy of the prompt.

Explicit document analysis happens on request by default. Automatic document analysis and background semantic indexing are opt-in because they can send workspace content to a provider. On-device text search, browsing, and connected knowledge remain usable without an AI connection. Large workspaces keep all permitted records eligible for later retrieval rather than silently shrinking the read boundary.

## Workbench and modules

Serenity is an installed Electron application for macOS, Windows, and Linux. Its center is an editable workbench: addressable resources open as tabs, panes can split and resize, and the arrangement restores with the workspace. Authored Home and other pages can contain links and bounded live queries. Commands have stable IDs; workspace settings control navigation and shortcuts. The interface uses restrained dark, light, and system appearances and keeps the active content more prominent than navigation or assistant controls.

The left side provides views and files. The assistant works beside the content or expands into a full-window conversation with history. One active workspace is supported at a time. Conversations are retained in the workspace by default, with controls to stop retention or delete them. Calendar and Tasks are internal modules that connect to knowledge through stable IDs. Turning a module off hides its interface and stops new writes while preserving its files. External calendar accounts and sync are separate future integrations.

External file edits are part of the workflow. Serenity should validate changed records, report issues, and refuse to overwrite a newer disk version without a choice. Imports are copies inside the selected workspace; paths outside it and symlinked content cannot masquerade as workspace records. Archiving and deletion should preserve enough context to understand and, where supported, reverse the action.

## Product boundary

Serenity 1.0 established the desktop workbench; 2.0 refined it into the current native-feeling interface. The shipped scope includes connected knowledge, internal calendar and tasks, document understanding, local and optional AI-assisted retrieval, and reviewed or permission-bounded assistant changes. Installable plugins, arbitrary external actions, built-in cloud or device sync, local models, mobile access, and simultaneous workspaces require separate designs and are not current features.

When extending the knowledge model, memory rules, autonomy boundary, or extension trust model, present the problem, viable approaches, tradeoffs, and a recommendation to the owner before making a durable decision. Prefer changes that preserve readable data, provenance, explicit permissions, and reversible correction.
