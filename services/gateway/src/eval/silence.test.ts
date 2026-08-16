import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifySilence } from '../agent/silence.js'

const MIN_ACCURACY = 0.95

interface Case {
  input: string
  expected: 'respond' | 'silent'
  category: string
  reason: string
}

const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'silence-cases.json')
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Case[]

describe('silence eval gate', () => {
  it('has exactly 1000 fixed cases', () => {
    expect(cases).toHaveLength(1000)
  })

  it('has valid structure (input/expected/category/reason, expected enum)', () => {
    for (const c of cases) {
      expect(typeof c.input).toBe('string')
      expect(['respond', 'silent']).toContain(c.expected)
      expect(typeof c.category).toBe('string')
      expect(typeof c.reason).toBe('string')
    }
    expect(new Set(cases.map((c) => c.input)).size).toBe(1000)
  })

  it('classifier accuracy >= 95% on the fixed set', () => {
    const correct = cases.filter((c) => classifySilence(c.input).decision === c.expected).length
    expect(correct / cases.length).toBeGreaterThanOrEqual(MIN_ACCURACY)
  })
})
