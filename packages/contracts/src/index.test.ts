import { describe, expect, it } from 'vitest'
import { isMessageContentType, MessageContentType } from './index.js'

describe('contracts', () => {
  it('accepts known message content types', () => {
    expect(isMessageContentType('text')).toBe(true)
    expect(isMessageContentType(MessageContentType.ConfirmationCard)).toBe(true)
    expect(isMessageContentType(MessageContentType.TaskCard)).toBe(true)
    expect(isMessageContentType(MessageContentType.System)).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isMessageContentType('carrier-pigeon')).toBe(false)
    expect(isMessageContentType(42)).toBe(false)
    expect(isMessageContentType(undefined)).toBe(false)
  })
})
