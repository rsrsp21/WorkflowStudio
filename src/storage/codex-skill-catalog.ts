import { readdir, readFile } from 'node:fs/promises';
import { ensureStudioHome } from '@/scripts/studio-home.cjs';
import path from 'node:path';
import type { PlanningSkillSummary } from '@/src/domain/planning';
import { createSkill, type Skill } from '@/src/domain/workspace';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';

function frontmatterValue(source: string, key: string): string {
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return (match?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function validSkillId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function findSkillFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 7) return [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(candidate);
    else if (entry.isDirectory()) files.push(...await findSkillFiles(candidate, depth + 1));
  }
  return files;
}

export async function discoverInstalledCodexSkills(): Promise<PlanningSkillSummary[]> {
  const home = ensureStudioHome();
  const roots = [home.skills, path.join(home.codex, 'skills')];
  const files = (await Promise.all(Array.from(new Set(roots)).map((root) => findSkillFiles(root)))).flat();
  const discovered = await Promise.all(files.map(async (file): Promise<PlanningSkillSummary | null> => {
    try {
      const source = await readFile(file, 'utf8');
      const id = validSkillId(frontmatterValue(source, 'name') || path.basename(path.dirname(file)));
      if (!id) return null;
      return { id, name: frontmatterValue(source, 'name') || id, description: frontmatterValue(source, 'description') || `Installed Codex skill ${id}.`, source: 'installed-codex', skillPath: file };
    } catch { return null; }
  }));
  const byId = new Map<string, PlanningSkillSummary>();
  for (const skill of discovered) if (skill && !byId.has(skill.id)) byId.set(skill.id, skill);
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function discoverUserCodexSkills(userId: string): Promise<PlanningSkillSummary[]> {
  if (!shouldUsePairedRuntime()) return discoverInstalledCodexSkills();
  const result = await dispatchPairedRuntimeJob<{ skills: PlanningSkillSummary[] }>(userId, 'skill-discovery', {});
  return Array.isArray(result.skills) ? result.skills : [];
}

export function installedSkillAsWorkspaceSkill(skill: PlanningSkillSummary): Skill {
  return createSkill({
    id: skill.id,
    familyId: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: `Use the Workflow Studio skill "${skill.name}".${skill.skillPath ? ` Read ${JSON.stringify(skill.skillPath)}.` : ''} Follow its SKILL.md instructions and supporting resources whenever this capability is invoked.`,
    triggers: [skill.name],
    validationCriteria: ['The installed skill contract is followed.'],
    source: 'Installed Codex skill',
    author: 'Codex',
    compatibility: ['Codex App Server', 'Codex CLI'],
    status: 'published',
    scope: { kind: 'global' }
  });
}

export function workspaceSkillAsPlanningSummary(skill: Skill): PlanningSkillSummary {
  return { id: skill.id, name: skill.name, description: [skill.description, ...skill.triggers].filter(Boolean).join(' '), source: 'workspace-registry' };
}

export async function buildPlanningSkillCatalog(storedSkills: Skill[], installedSkills?: PlanningSkillSummary[]): Promise<PlanningSkillSummary[]> {
  const catalog = new Map<string, PlanningSkillSummary>();
  for (const skill of installedSkills ?? await discoverInstalledCodexSkills()) catalog.set(skill.id, skill);
  for (const skill of storedSkills.filter((candidate) => candidate.status === 'published')) {
    // Old global-skill registrations must not reappear after switching homes.
    if (skill.source === 'Installed Codex skill') continue;
    catalog.set(skill.id, workspaceSkillAsPlanningSummary(skill));
  }
  return Array.from(catalog.values());
}
