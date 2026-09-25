import type { WorkbenchConfig } from './types'

export const defaultWorkbench: WorkbenchConfig = {
  homePage: 'home',
  navigation: [
    { group: 'Workspace', commands: ['view.home', 'view.knowledge', 'view.review'] },
    { group: 'Organize', commands: ['view.documents', 'view.calendar', 'view.tasks'] },
    { group: 'More', commands: ['view.activity', 'view.settings'] }
  ]
}
