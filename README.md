# Serenity

Serenity is a desktop knowledge workspace for keeping notes and source material together, making sense of conflicting information, and revisiting decisions as you learn more.

You can write freely, collect documents, and connect what you learn about people, projects, and other things you care about. When sources disagree, Serenity keeps their statements separately. You can choose a current answer and record why, while keeping the alternatives available for later review.

An assistant can help you read and organize this material. Its suggestions become additions you can review, with optional automatic saving for the kinds of records you permit. Your knowledge lives in a folder you choose and remains usable without an AI provider.

[Download](https://github.com/shriism/serenity/releases) · [Product and design](SERENITY.md) · [Architecture](ARCHITECTURE.md) · [Development](CONTEXT.md) · [Changelog](CHANGELOG.md)

## Working in Serenity

Start with a page or import a document. Open related material side by side, follow links, and search its text. When something needs to be tracked across sources, give it a record and add sourced statements about it. Tasks and calendar events can link to those same records.

Suppose Alex tells you their birthday is September 7, while an old card says September 8. Both statements can remain in the workspace with their sources. Mark September 7 as current with the reason “Alex told me directly.” If you later change your mind, select another answer or clear the choice. The earlier statements and decisions remain visible.

You can also compare records that might describe the same person, merge them, or record that they are distinct. A merge can be undone. User-removed pages, documents, entities, tasks, and events go to your computer’s Trash; merge history remains in the workspace. These interactions let you organize information without having to settle every uncertainty when you first encounter it.

The assistant works alongside this process. Ask about a document, inspect the answer's citations, and review suggested additions beneath the reply or in Review. GitHub Copilot and OpenAI Codex are supported. Local editing and text search work without either.

## Get started

Download a build from [GitHub Releases](https://github.com/shriism/serenity/releases), or run from source with Node.js 24 or newer:

```sh
git clone https://github.com/shriism/serenity.git
cd serenity
npm ci
npm run dev
```

When Serenity opens:

1. Choose or create a workspace folder.
2. Select **New page** to write, or **Import documents** to bring in source material. Imports are copies.
3. Configure a supported provider when you want to use the assistant. Its default mode, **Read & propose**, leaves suggested additions for you to review.

Serenity currently opens one workspace at a time. Calendar and Tasks are internal tools; external account sync is not implemented. There is no built-in device sync, local model integration, mobile client, or installable plugin system.

AI scope controls select the context Serenity assembles; they do not yet guarantee that other files are inaccessible to every provider runtime. See [provider access](ARCHITECTURE.md#provider-access) for the current boundary and how background AI differs from chat.

## Your files

Pages and entity notes are Markdown with YAML frontmatter. Statements, decisions, and other structured records are YAML. You can inspect these files with ordinary tools, edit them outside Serenity, and back up the whole folder. Serenity detects external changes and checks revisions before saving over an edited file.

Search indexes can be rebuilt from the records. Keep backups of the complete workspace, including `.serenity/`, which also holds settings. History is preserved for specific knowledge decisions; ordinary text edits and permanent deletions do not have a universal undo.

## Learn more

- [Product and design](SERENITY.md): the knowledge model, important interactions, tradeoffs, and open questions.
- [Architecture](ARCHITECTURE.md): storage, processes, data flow, and implementation limits.
- [Development](CONTEXT.md): setup, tests, packaging, and the repository map.
- [Changelog](CHANGELOG.md): changes by version.
