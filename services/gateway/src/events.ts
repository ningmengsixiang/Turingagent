import { EventEmitter } from 'node:events'

export function createEvents() {
  return new EventEmitter()
}
