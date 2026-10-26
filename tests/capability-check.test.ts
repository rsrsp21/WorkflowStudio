import { describe, expect, it } from 'vitest';
import { checkWorkflowCapabilities } from '@/src/domain/capability-check';
import type { WorkflowPlan } from '@/src/domain/models';
import type { ProjectWorkflow, Skill } from '@/src/domain/workspace';

const plan = { nodes: [{ skillIds: ['ui-skill'] }] } as WorkflowPlan;
const assignment = { selectedSkills: [{ skillId: 'ui-skill', version: 1 }], permissions: { allowedTools: [] } } as unknown as ProjectWorkflow;
const skill = { id: 'ui-skill', version: 1, status: 'published', requiredPermissions: ['workspace.read', 'credential:figma'] } as unknown as Skill;

describe('workflow capability preflight', () => {
  it('reports missing tools, credentials, and companion connectivity', () => {
    const issues = checkWorkflowCapabilities(plan, assignment, [skill], false);
    expect(issues.map((issue) => issue.kind)).toEqual(['tool', 'credential', 'companion']);
    expect(issues.map((issue) => issue.message).join(' ')).toContain('Pair the local Workflow Studio companion');
  });

  it('passes when selected capabilities and permissions are available', () => {
    const ready = { ...assignment, permissions: { ...assignment.permissions, allowedTools: ['workspace.read'] } } as ProjectWorkflow;
    expect(checkWorkflowCapabilities(plan, ready, [skill], true)).toEqual([{ kind: 'credential', key: 'credential:figma', message: 'Missing credential: figma must be connected before this workflow can run.' }]);
  });
});
