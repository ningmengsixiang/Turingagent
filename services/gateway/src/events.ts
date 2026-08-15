import { EventEmitter } from 'node:events'
import type { Message } from '@ta/contracts'

export type AppEvents = {
  'message.created': (message: Message) => void
}

export interface AppEventBus {
  on<K extends keyof AppEvents>(event: K, listener: AppEvents[K]): void
  emit<K extends keyof AppEvents>(event: K, payload: Parameters<AppEvents[K]>[0]): void
}

export function createEvents(): AppEventBus {
  const emitter = new EventEmitter()
  return {
    on(event, listener) {
      emitter.on(event, listener)
    },
    emit(event, payload) {
      emitter.emit(event, payload)
    },
  }
}
