import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectTemplate } from '@ta/contracts'

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../templates')

/** 模板注册表：每次调用重读（热加载，与 skills 同模式） */
export function listTemplates(): ProjectTemplate[] {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'))
  const templates: ProjectTemplate[] = []
  for (const f of files) {
    try {
      templates.push(JSON.parse(readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')) as ProjectTemplate)
    } catch (err) {
      console.error(`[templates] failed to load ${f}:`, err)
    }
  }
  return templates.sort((a, b) => a.id.localeCompare(b.id))
}

export function getTemplate(id: string): ProjectTemplate | null {
  return listTemplates().find((t) => t.id === id) ?? null
}
