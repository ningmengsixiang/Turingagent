import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Skill } from '@ta/contracts'

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

/** 技能包注册表：每次调用重读目录（热加载——新增/修改 manifest 即时生效） */
export function listSkills(): Skill[] {
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.json'))
  const skills: Skill[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(SKILLS_DIR, f), 'utf8')) as Skill
      skills.push(raw)
    } catch (err) {
      console.error(`[skills] failed to load ${f}:`, err)
    }
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export function getSkill(id: string): Skill | null {
  return listSkills().find((s) => s.id === id) ?? null
}
