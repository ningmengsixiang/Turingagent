import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MarketplaceSkill } from '@ta/contracts'

const MARKETPLACE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../marketplace')
const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

/** 技能包 id 白名单（防路径穿越） */
const SKILL_ID_RE = /^[a-z0-9-]{1,64}$/

interface SkillManifest {
  id: string
  name: string
  description: string
  toolAllowlist: string[]
}

function readManifest(file: string): SkillManifest | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SkillManifest
  } catch (err) {
    console.error(`[marketplace] failed to load ${file}:`, err)
    return null
  }
}

/** 市场技能包列表（含已安装标记） */
export function listMarketplaceSkills(): MarketplaceSkill[] {
  const files = readdirSync(MARKETPLACE_DIR).filter((f) => f.endsWith('.json'))
  const skills: MarketplaceSkill[] = []
  for (const f of files) {
    const manifest = readManifest(path.join(MARKETPLACE_DIR, f))
    if (!manifest || !SKILL_ID_RE.test(manifest.id)) continue
    skills.push({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      toolAllowlist: manifest.toolAllowlist,
      installed: existsSync(path.join(SKILLS_DIR, `${manifest.id}.json`)),
    })
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export function getMarketplaceSkill(id: string): MarketplaceSkill | null {
  return listMarketplaceSkills().find((s) => s.id === id) ?? null
}

/** 安装市场技能包到本地（覆盖需 force）；返回是否覆盖 */
export function installSkill(id: string, force: boolean): { installed: boolean; overwritten: boolean } {
  if (!SKILL_ID_RE.test(id)) throw new Error('invalid skill id')
  const source = path.join(MARKETPLACE_DIR, `${id}.json`)
  if (!existsSync(source)) throw new Error('skill not found in marketplace')
  const target = path.join(SKILLS_DIR, `${id}.json`)
  const overwritten = existsSync(target)
  if (overwritten && !force) throw new Error('skill already installed (use force to overwrite)')
  copyFileSync(source, target)
  return { installed: true, overwritten }
}
