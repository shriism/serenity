import type { SerenityAPI } from '../../shared/types'

declare global {
  interface Window {
    serenity: SerenityAPI
  }
}
