export const modules = [
  { id: 'calendar', title: 'Calendar', description: 'Events and dates connected to your knowledge' },
  { id: 'tasks', title: 'Tasks', description: 'Things to do, connected to people and projects' },
  { id: 'semanticIndex', title: 'Background AI index', description: 'Send changed knowledge to your chosen provider to build searchable summaries' },
  { id: 'documentAnalysis', title: 'Automatic document analysis', description: 'Analyze new or changed documents and draft knowledge proposals' }
] as const

export type ModuleId = (typeof modules)[number]['id']
