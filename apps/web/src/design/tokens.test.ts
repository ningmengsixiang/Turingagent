import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tokensCss = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
)

const REQUIRED_TOKENS = [
  '--ta-color-brand',
  '--ta-color-brand-soft',
  '--ta-color-success',
  '--ta-color-danger',
  '--ta-color-warning',
  '--ta-color-text-primary',
  '--ta-color-text-secondary',
  '--ta-color-border',
  '--ta-color-bg',
  '--ta-color-bg-secondary',
  '--ta-font-family',
  '--ta-font-md',
  '--ta-space-2',
  '--ta-space-4',
  '--ta-radius-md',
  '--ta-radius-lg',
  '--ta-shadow-sm',
  '--ta-shadow-md',
  '--ta-duration-normal',
]

describe('design tokens', () => {
  it('defines all required tokens', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(tokensCss).toContain(token)
    }
  })

  it('uses valid color hex values', () => {
    const hexes = tokensCss.match(/#[0-9a-fA-F]{3,8}/g) ?? []
    expect(hexes.length).toBeGreaterThan(5)
    for (const hex of hexes) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/)
    }
  })
})
