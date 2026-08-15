import { EventEmitter } from 'node:events'

export type AppEvents = {
  'message.created': (message: unknown) => void
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
