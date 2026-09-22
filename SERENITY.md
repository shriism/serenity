# SERENITY.md

# Serenity

## A Human-AI Integrated Personal Knowledge Environment

------------------------------------------------------------------------

# Project Overview

Serenity is a human-AI collaborative environment designed to create an
evolving representation of an individual's life, knowledge, experiences,
relationships, goals, and activities.

Serenity is not a chatbot, note-taking app, calendar replacement, or
task manager.

Those are interfaces.

The core system is:

> A personal knowledge architecture where humans and AI collaboratively
> construct, maintain, and interact with a model of a person's world.

------------------------------------------------------------------------

# Vision

Modern digital life is fragmented:

-   Calendar
-   Notes
-   Contacts
-   Messages
-   Documents
-   Tasks
-   School systems
-   Files

Humans manually connect these systems.

Serenity creates a unified environment where information becomes
connected.

The system should represent:

-   People
-   Relationships
-   Experiences
-   Knowledge
-   Concepts
-   Education
-   Work
-   Projects
-   Goals
-   Tasks
-   Events
-   Places

The AI helps organize, connect, retrieve, and act upon this information.

------------------------------------------------------------------------

# Core Philosophy

## Human-AI Collaboration

Serenity is a partnership.

The human provides:

-   meaning
-   values
-   corrections
-   interpretation
-   final decisions

The AI provides:

-   organization
-   extraction
-   suggestions
-   connections
-   retrieval
-   automation

The AI should never silently redefine the user's world.

------------------------------------------------------------------------

# Dynamic Ontology

The categories of human life are NOT fixed.

Serenity must not hardcode a universal structure.

Categories such as:

-   People
-   School
-   Work
-   Projects
-   Goals

are examples, not rules.

The system should allow humans and AI to discover useful categories
naturally.

Categories are hypotheses.

The AI can suggest:

"I noticed many connected items related to research communities. Would
you like to create this category?"

The human decides.

------------------------------------------------------------------------

# Collaboration Model

## Human Role

The human is the architect and researcher.

The human decides:

-   how life should be represented
-   ontology decisions
-   memory principles
-   AI interaction rules
-   evaluation criteria
-   major architecture decisions

## AI Role

The AI is a senior engineering collaborator.

The AI should:

-   implement systems
-   write code
-   explain decisions
-   suggest alternatives
-   identify problems
-   teach concepts

The AI should not silently decide fundamental design choices.

------------------------------------------------------------------------

# Development Rules

Before major decisions:

Explain:

1.  The problem.
2.  Possible approaches.
3.  Tradeoffs.
4.  Recommendation.

Then allow the human to decide.

Do not silently choose:

-   knowledge representation
-   ontology structure
-   memory rules
-   autonomy boundaries

------------------------------------------------------------------------

# Architecture

Serenity consists of:

    Human Interface
           |
           |
    Knowledge Engine
           |
    -------------------------
    Entities
    Relationships
    Memory
    Timeline
    Tasks
    Documents
    Retrieval
    AI Agent
    -------------------------
           |
    Storage Layer

    Markdown + YAML
    Knowledge Graph
    Vector Index

------------------------------------------------------------------------

# Data Representation

Serenity uses Markdown + YAML.

Markdown is the human layer.

It stores:

-   thoughts
-   context
-   explanations
-   narratives

YAML is the machine layer.

It stores:

-   metadata
-   relationships
-   attributes
-   confidence
-   sources

Example:

``` markdown
---
entity_type: person

name:
  - Alex

attributes:
  birthday:
    value: September 7
    confidence: confirmed

relationships:
  - type: friend

sources:
  - conversation

---

# Alex

I met Alex at AI Club.

We discussed robotics and machine learning.
```

------------------------------------------------------------------------

# Knowledge Model

Serenity should support:

-   entities
-   relationships
-   experiences
-   events
-   concepts
-   goals
-   tasks
-   documents
-   places
-   organizations

However, the model must evolve.

Avoid rigid schemas.

General entity structure:

    Entity

    id

    type

    properties

    relationships

    history

    sources

    confidence

------------------------------------------------------------------------

# Memory Formation

Serenity should not save everything.

Information enters through a process:

    Conversation

    ↓

    Information Extraction

    ↓

    Entity Resolution

    ↓

    Memory Proposal

    ↓

    Human Confirmation

    ↓

    Knowledge Update

Example:

User:

"Remember Alex's birthday is September 7."

The system checks:

-   Does Alex exist?
-   Is this new information?
-   Should this become memory?

------------------------------------------------------------------------

# Entity Resolution

A core capability.

The system must determine:

"Is this the same thing?"

Example:

Alex could mean:

-   Alex Chen from AI Club
-   Alex from high school
-   A new person

The system should:

-   find candidates
-   estimate confidence
-   ask for clarification

------------------------------------------------------------------------

# Provenance

Every piece of knowledge needs origin.

Example:

Explicit:

    Memory:
    Alex birthday is September 7

    Source:
    User stated

    Confidence:
    1.0

Inference:

    Memory:
    Alex likes robotics

    Source:
    AI inference

    Confidence:
    0.65

Never mix facts and AI assumptions.

------------------------------------------------------------------------

# Retrieval

Serenity should not rely only on keywords.

Retrieval should combine:

-   semantic search
-   relationships
-   categories
-   context
-   time

Example:

Question:

"What should I get Alex for his birthday?"

Retrieval:

    Person

    ↓

    Alex

    ↓

    Experiences

    ↓

    Preferences

    ↓

    Suggestions

------------------------------------------------------------------------

# AI Capabilities

The AI has three roles.

## Observer

Reads:

-   conversations
-   documents
-   notes
-   files

Extracts useful information.

## Organizer

Suggests:

-   connections
-   categories
-   summaries
-   relationships

## Assistant

Uses knowledge to:

-   answer questions
-   plan
-   create tasks
-   interact with external systems

------------------------------------------------------------------------

# Example Workflows

## Course Integration

User uploads a syllabus.

Serenity extracts:

-   course
-   assignments
-   deadlines
-   topics
-   professor
-   skills

Then connects:

    Course

    ↓

    Topics

    ↓

    Skills

    ↓

    Projects

and creates calendar events.

------------------------------------------------------------------------

## Person Integration

User:

"Alex's birthday is September 7."

Serenity:

    Searching existing knowledge...

    No confirmed Alex found.

    Create person entity?

    Add relationship?

    Add more information?

------------------------------------------------------------------------

# Development Roadmap

## Phase 1

Build:

-   GUI
-   Markdown/YAML storage
-   entity system
-   browsing interface

## Phase 2

Build:

-   AI extraction
-   memory proposals
-   entity resolution

## Phase 3

Build:

-   semantic retrieval
-   relationships
-   knowledge graph

## Phase 4

Build:

-   calendar integration
-   document understanding
-   mobile interaction
-   autonomous workflows

------------------------------------------------------------------------

# Research Questions

Serenity explores:

-   How should AI represent human life?
-   How should personal knowledge evolve?
-   How can humans and AI create categories together?
-   How should memory formation work?
-   How should AI distinguish facts from inference?
-   How should personal agents maintain long-term context?

------------------------------------------------------------------------

# Final Principle

Serenity is not meant to replace human thought.

Human creates meaning.

AI helps organize meaning.

Together they create an evolving representation of a person's world.

The goal is not a smarter chatbot.

The goal is a better relationship between humans, knowledge, and AI.

------------------------------------------------------------------------

# Product Direction (September 2026)

Serenity is intended to be a complete product, not a set of separate
phase deliverables. The development roadmap above lists capabilities to
build; it does not define a staged or reduced version of the product.

## Application

- Serenity runs as an installed application on macOS, Windows, and Linux.
- macOS is the initial development and testing environment. Cross-platform
  behavior is a product requirement, not an optional later feature.
- When Serenity opens, it lets the person choose a directory or location
  on their device for their personal data. The selected location must be
  visible and changeable; Serenity must not silently choose a hidden store.
- Personal knowledge is stored on the device in the chosen location, using
  the Markdown + YAML representation described above.
- Cloud storage, syncing between devices, and other storage integrations
  may be supported later. They are not required for on-device use.
- Build the cross-platform desktop application with Electron and
  TypeScript. Keep the interface separate from the knowledge engine and
  from provider-specific AI integrations; the interface should access
  filesystem and AI capabilities through explicit application APIs.
- Electron is the final desktop framework choice. A mobile application is
  a future goal; design reusable knowledge logic and interface concepts
  without assuming that Electron itself runs on mobile. Mobile filesystem
  access and AI integrations will need platform-appropriate implementations.

## AI Integrations

- Support GitHub Copilot SDK, OpenAI Codex SDK, and Claude Agent SDK through
  distinct integrations. The person using Serenity should be able to choose
  the integration rather than have knowledge tied to one provider.
- GitHub Copilot SDK is the primary integration for development and testing.
  Codex and Claude are also product requirements, not replacements for it.
- For now, use provider-backed AI services. The application itself runs
  locally, but its AI models run through the selected provider's service.
- Add support for locally running AI models later, without making personal
  knowledge dependent on a particular AI integration.
- Keep provider-specific authentication, sessions, and capabilities behind
  their respective integrations. Knowledge, provenance, memory proposals,
  and human confirmation belong to Serenity, not to a provider's session.
- AI integrations must respect Serenity's human confirmation and autonomy
  boundaries regardless of which provider is selected.

On-device knowledge storage is separate from AI model execution: choosing
a local directory does not require running AI models locally.

## Knowledge Representation Decision

Use readable Markdown + YAML entity files together with a separate,
structured history of claims. Entity files provide human-readable context;
claims preserve the individual assertions behind facts and relationships.

- Give entities stable identifiers so renaming or recategorizing an entity
  does not break its relationships or history.
- Keep types and categories extensible rather than imposing a universal
  ontology. Humans decide whether suggested categories become part of
  their knowledge environment.
- Associate each claim with its subject, content, source, and status.
  Distinguish direct statements from AI inference and unconfirmed proposals.
- Preserve corrections and conflicting claims with their provenance rather
  than silently replacing a prior assertion. Show the user what is known,
  what is inferred, and what still needs confirmation.
- Make entity files and the claim history consistent through the knowledge
  engine. Provider-specific sessions are not the source of truth.

The exact on-disk layout and claim serialization remain implementation
details to work through without weakening these requirements.

## User-Configured AI Autonomy

Autonomy is chosen by the person using Serenity, not fixed to a single
approval rule. People can choose different permissions for different
workflows, and change those choices later. For example, one workflow may
only read selected knowledge and propose edits, while another may save
claims or perform approved classes of external actions automatically.

- Offer understandable starting modes such as ask before actions,
  read-and-propose, and bounded autonomous execution. Allow permissions
  to be refined by workflow and action instead of making a single global
  mode the only control.
- Make each workflow's scope clear: which knowledge it can read, what it
  can change, which external systems it can access, and which actions
  still require confirmation.
- Apply the person's permissions consistently across Copilot, Codex,
  Claude, and future AI integrations. A provider's default tool access
  must not silently override Serenity's settings.
- Record actions and their provenance so the person can see what the AI
  did, review changes, and correct mistakes. Preserve previous claims
  rather than silently erasing them.
- A proposal-and-human-confirmation path is always available, but is not
  required for every knowledge update when the person has explicitly
  enabled autonomy for that workflow.

The Memory Formation diagram above describes the confirmation path, not
the only permitted workflow. "Never silently redefine the user's world"
means autonomous changes must stay within permissions the human chose
and remain visible and accountable.

## Storage and Workspace Decisions

- Store the claim history in human-inspectable YAML claim files alongside
  the Markdown + YAML entity files. Use SQLite as a rebuildable index for
  efficient search and navigation; the index is not the source of truth.
- Present an integrated workspace with conversation, knowledge browsing,
  and a proposal/activity inbox. People should be able to inspect the
  knowledge and actions behind AI responses rather than relying on chat
  transcripts alone.
- Start new workflows in read-and-propose mode: the AI can read knowledge
  made available to that workflow and suggest changes, while saving
  knowledge or taking external actions requires confirmation. People can
  change permissions for each workflow, including granting bounded
  autonomy explicitly.

## Editing, Conflicts, and AI Workspace Access

- Support two-way editing of the chosen workspace. Detect changes made
  outside Serenity, validate and incorporate readable changes, and show
  issues that need repair instead of silently discarding those edits.
- When claims conflict, show the competing assertions and their sources,
  suggest the most likely answer with appropriate uncertainty, and ask
  the person for clarification when their identity or the answer is
  ambiguous. Do not silently discard or overwrite competing claims.
- The selected workspace is shared between the human and the AI: the AI
  may read files throughout it by default. A person may deliberately
  restrict a workflow's scope, but Serenity must not impose an invisible
  narrower read boundary within the workspace.
- Full read access is different from sending the entire directory's
  contents to a provider in every request. Retrieve and transmit context
  as needed for the task, and make provider activity inspectable. Changes
  to knowledge and external actions still follow the workflow's chosen
  permissions.

## Workspace and Conversation Decisions

- Support one active workspace at launch. Let the person choose its
  on-device directory when opening Serenity; additional simultaneous or
  linked workspaces can be considered later.
- Make conversation retention user-controlled. Save conversations in the
  workspace by default, and provide clear controls to delete them or
  exclude conversations from retention. Keep provenance for retained
  knowledge independently of any conversation that is deleted.
- Allow a visible conversation to continue when switching between
  Copilot, Codex, and Claude. Identify the provider responsible for each
  message and pass the conversation context needed for continuity;
  provider-private session state does not transfer between providers.

## Ingestion, Identity, and Search Decisions

- Handle potential duplicate entities according to the workflow's
  autonomy permissions. When identity is unclear, present the candidates
  and ask for clarification. A workflow granted appropriate autonomy may
  merge sufficiently clear matches; preserve merge history and make the
  result reviewable and correctable. The default read-and-propose mode
  proposes a merge rather than applying it.
- Copy imported documents into the chosen workspace so their sources
  remain available if the original file is moved or deleted.
- Provide hybrid retrieval combining on-device text search, relationships,
  and time with provider-backed semantic search. Keep the on-device
  browsing and search capabilities usable without an AI connection;
  make semantic indexing and its provider activity visible to the user.

## Setup and Import Decisions

- Keep workspace Markdown, YAML, and imported source files readable on
  disk and directly editable with other applications. Device-level disk
  protection is separate from Serenity's workspace format.
- Support provider-native sign-in where the SDK permits it and
  provider-specific API-key authentication where required or offered.
  Authentication differs by provider; do not store credentials inside
  the chosen knowledge workspace.
- Explicitly imported documents are analyzed at the person's request by
  default. Let them enable automatic analysis for chosen workflows or
  folders, subject to that workflow's autonomy settings. Copy imported
  documents into the workspace as decided above.

## Modular Features, Calendar, and Merges

- Serenity has its own on-device calendar and task capabilities. Calendar
  and tasks are internal modules, not external calendar accounts or
  third-party sync. Earlier roadmap references to calendar integration
  mean integration with Serenity's own knowledge environment here.
- Keep features modular so people can enable or disable modules such as
  calendar or tasks without destroying their data. Do not force every
  person's world into one fixed ontology. Modules connect naturally to
  the shared knowledge model through stable entity identifiers and
  relationships rather than isolated copies of people or projects.
- When merging duplicate entities, archive the duplicate's file and
  preserve its history and sources. Update references so existing links
  lead to the surviving entity. Make merge actions reviewable.
- Use AI-backed semantic search on demand by default. A person may opt
  into background semantic indexing, which may send workspace content
  to their selected provider and incur usage. Keep this choice visible.

## Further Product Decisions

- Support Obsidian-like enabling and disabling of Serenity's built-in
  modules. Adding a module currently requires a Serenity code change;
  third-party plugin installation is not a current requirement.
- For workspaces larger than a provider request, keep every workspace
  record eligible for AI retrieval. Select relevant records using local
  search and make the transmitted records visible. Retrieve again when
  needed rather than imposing a hidden, permanent read restriction.
- Preserve all sourced claims when a fact is corrected. After human
  confirmation, mark the applicable claim as the current answer so an
  old mistake does not remain an unresolved conflict. Keep the previous
  claims and the resolution visible and reversible.
