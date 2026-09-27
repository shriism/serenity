/**
 * What Serenity asks a provider to do with an imported document, for both the Analyze action and automatic analysis.
 * It asks for structure a person can review (entities, sourced facts and relationships, dated tasks and events) and
 * forbids inventing what the document does not say.
 */
export function documentAnalysisPrompt(name: string, reason: 'requested' | 'changed' = 'requested'): string {
  return [
    `Analyze the ${reason === 'changed' ? 'newly added or changed ' : ''}imported document "${name}".`,
    'Summarize what it is in two or three sentences, then propose what should be remembered from it:',
    '- Entities for the people, organizations, courses, projects, places, topics, and skills it describes. Check the workspace catalog first and use an existing entity instead of proposing a duplicate; ask me when an identity is ambiguous.',
    '- Claims for facts about existing entities, and relationships between existing entities (the claim value is the related entity\'s ID), such as who teaches or leads something, which topics a course covers, or which skill a topic builds. Describe relationships among entities you are newly proposing in their descriptions; they can be linked once accepted.',
    '- A task for each deliverable or deadline with a due date (YYYY-MM-DD), and an event for each scheduled session, meeting, or exam, related to the relevant existing entities.',
    `Give every proposal the source "${name}", followed by a location such as ", p. 2" or ", Week 3" when you can tell where it came from.`,
    'Do not invent dates, people, or facts the document does not state, and mark anything inferred rather than stated as ai-inference.'
  ].join('\n')
}
