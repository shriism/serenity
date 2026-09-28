# Product and design

Serenity is built around the work of maintaining an understanding over time. You collect information, connect it to what you already know, decide what to rely on, and sometimes revise that decision. A useful workspace needs to support the revision as well as the initial recording.

Three choices shape Serenity: statements keep their sources; current answers are separate decisions; and AI suggestions enter through an explicit acceptance workflow. Together, these choices let the person inspect how information became part of their workspace and decide what to do with it next.

For installation, see the [README](README.md). For storage and runtime details, see [Architecture](ARCHITECTURE.md).

## Structure when it helps

A page gives you room to write without deciding how every sentence should be classified. Documents keep the material you are reading nearby. Search and links help you return to it.

When a person, project, place, or idea recurs across that material, you can give it an **entity**: a record with a stable identity and a Markdown narrative. You choose its category. The stable identity lets other records continue referring to it when its title changes.

A statement about that entity is a **claim**. It names the subject, a property or relationship, a value, and a source. For example, a person can have a birthday attributed to a conversation and a membership relationship pointing to a group. Sources can be personal statements or document references; matching imported documents can be opened from the claim.

This structure makes comparison and attribution possible, but it takes more effort than writing a paragraph. Pages remain useful for information that does not need that treatment. Notes, search, links, tasks, and calendars provide familiar ways to work; the sourced statements and recorded decisions connect them.

## A current answer has a reason

Suppose Alex says their birthday is September 7, but an old card says September 8. You can record both. Neither has to disappear for the other to be useful.

Serenity shows different accepted values for the same property as a conflict when no answer has been selected. You can leave the question open, or mark September 7 as current and explain, “Alex told me directly.” The selection is a separate record called a **resolution**. Both claims remain, along with their sources.

Later, you can choose September 8 or clear the current designation. Each choice adds a decision to the history. If you decide the card was wrong, retract its claim with a reason. The retracted statement remains available in the entity's history, showing what you once recorded and why you stopped relying on it.

This makes the distinction between a statement and your judgment about it visible. A recent timestamp or a confident AI response does not select the current answer for you.

The current conflict model is simple: different values under one property. Some properties legitimately have several values, and Serenity does not determine whether a difference is a contradiction, a change over time, or several valid answers. Interpreting that difference remains human work.

## Identity is a decision too

“Alex” and “Alex M.” may describe one person. Serenity suggests possible duplicates using similar names, categories, and shared accepted facts, and shows the reasons for the suggestion. You decide whether they refer to the same identity.

A merge brings their information together while retaining the original entity in the archive. If the decision was wrong, undoing it restores the entity and records the reason for the reversal. If the records describe different people, mark them distinct: Serenity stops suggesting that pair and blocks a merge until you undo that decision.

An assistant can also suggest a person who already has a record. You can attach the suggestion to the existing entity as sourced context instead of creating a duplicate.

Preserving these decisions makes correction possible, at the cost of keeping more history and asking for judgment where a name match alone would be easier to automate.

## The assistant proposes additions

The assistant can answer questions about supplied material and suggest claims, entities, tasks, or calendar events. Each suggested addition is a **proposal**, separate from the answer itself. You can compare it with its recorded source, accept it, or reject it. Review groups suggestions by source so related additions can be considered together.

The default **Read & propose** mode keeps suggestions pending. **Ask first** also requires acceptance before additions are saved. **Auto-save permitted** allows automatic acceptance by record type: sourced claims are the initial permission, while entities, tasks, and events require separate grants. New entity categories and detected identity ambiguity still require review.

Accepted claims retain whether they came from a human statement, AI extraction, or AI inference. The stored status `confirmed` means accepted into the workspace, including through permitted automatic saving. It does not establish that the statement has been independently verified. A model's confidence estimate and a recorded source help you examine a claim; neither proves it.

Automatic saving reduces review work but places more responsibility on the permissions you choose and your later inspection. The current workflows add records; they do not give the assistant general authority to rewrite the workspace or perform external actions.

## Context you can inspect

Conversation settings let you choose whole-workspace context or selected entities and documents. The assistant prioritizes permitted material you have open. Messages record which workspace records Serenity supplied, and citations indicate whether a referenced record was supplied and whether quoted text occurs in it. You can return to the material and assess the answer yourself.

These controls are incomplete as a privacy boundary. Narrowing a conversation's scope does not remove its earlier discussion, and AI search and background operations use separate workspace-wide context. Provider runtime access also differs between integrations. The precise controls and gaps are documented under [provider access](ARCHITECTURE.md#provider-access).

Automatic document analysis and background AI indexing are off by default. Enabling them permits provider calls outside an individual chat. Local text search remains available without them.

## Knowledge that outlives a conversation

Serenity keeps knowledge records and decisions in the workspace folder, separate from an AI provider's private session. A visible conversation can continue with another provider, while statements and their histories remain the same records. Generated search summaries are derived aids that can be replaced without replacing the underlying knowledge.

Markdown and YAML make that separation practical. You can read the material without Serenity, inspect its structure, and use ordinary file tools to back it up. External edits are part of the workflow; revision checks help prevent an editor from silently overwriting a newer disk version.

There are costs to this choice. Structured files have a schema to preserve, other applications may not interpret their relationships, and backups are the user's responsibility. Readability helps recovery; it does not make every operation reversible.

History is retained for current-answer decisions, retractions, merges, and identity judgments. Ordinary page edits replace text rather than keeping every version. Archiving keeps files, with restoration controls for tasks and calendar events. **Deleting a chat can permanently remove its attributable knowledge as well as its transcript**, subject to dependency checks. These different meanings of removal need a more consistent product treatment.

## Open questions and direction

Serenity currently supports personal work in one desktop workspace. Its extension registries organize built-in views and commands; they are groundwork, not an installable plugin API. Sync, external calendar accounts, local models, mobile access, and simultaneous workspaces would require separate designs.

The nearer design questions concern the existing model:

- How should accepting a statement differ from verifying its evidence, especially with automatic saving?
- How should the workspace represent changes over time and properties with several valid answers?
- How should source references survive document renames and edits?
- How should chat deletion affect knowledge that has become useful outside that chat?
- How can provider access match the scope shown to the person across conversations and background operations?

These are unresolved questions, not promised features. Further work should make the existing relationships between evidence, interpretation, and action easier to understand and control.
