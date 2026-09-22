export const modules = [
  { id: 'calendar', title: 'Calendar', description: 'Events and dates connected to your knowledge' },
  { id: 'tasks', title: 'Tasks', description: 'Things to do, connected to people and projects' }
] as const

export type ModuleId = (typeof modules)[number]['id']
