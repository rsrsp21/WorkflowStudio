import { describe, expect, it } from 'vitest';
import { materializeWorkflowSkillDrafts } from '@/src/domain/generated-skills';
import { createSkill } from '@/src/domain/workspace';
import { validPlan } from './fixtures';

describe('workflow skill materialization', () => {
  it('keeps final workflow checks out of an early validation skill', () => {
    const source = validPlan();
    source.completionCriteria = ['Generated screen images conform to the approved direction.', 'The final screen package receives human approval.'];
    source.nodes = [{ id: 'coverage', name: 'Validate task coverage', type: 'validation', prompt: 'Check that the proposed inventory covers every approved task.', skillIds: [], inputKeys: ['approved_tasks', 'screen_inventory'], outputKeys: ['coverage_decision'], retryLimit: 0, requiresApproval: false }];
    const result = materializeWorkflowSkillDrafts(source, []);
    const criteria = result.drafts[0].validationCriteria.join('\n');

    expect(criteria).toContain(source.nodes[0].prompt);
    expect(criteria).toContain('approved_tasks, screen_inventory');
    expect(criteria).toContain('coverage_decision');
    for (const criterion of source.completionCriteria) expect(criteria).not.toContain(criterion);
    expect(result.plan.completionCriteria).toEqual(source.completionCriteria);
  });

  it('labels checks for shared skills by node and includes only declared artifacts', () => {
    const source = validPlan();
    source.nodes = source.nodes.map((node, index) => ({ ...node, skillIds: ['shared'], requiredArtifacts: index === 1 ? ['Review report'] : [] }));
    const result = materializeWorkflowSkillDrafts(source, []);
    const criteria = result.drafts[0].validationCriteria;

    for (const node of source.nodes) expect(criteria).toContain(`For "${node.name}", verify only this stage's instructions: ${node.prompt}`);
    expect(criteria).toContain(`For "${source.nodes[1].name}", produce the required artifact: Review report.`);
    expect(criteria).not.toContain(`For "${source.nodes[0].name}", produce the required artifact: Review report.`);
  });

  it('creates draft skills for Codex references and executable nodes without references', () => {
    const source = validPlan();
    const result = materializeWorkflowSkillDrafts(source, []);

    expect(result.plan.nodes.every((node) => node.skillIds.length > 0)).toBe(true);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.every((skill) => skill.status === 'draft')).toBe(true);
    expect(result.drafts.every((skill) => skill.scope.kind === 'workflow' && skill.scope.workflowId === source.id)).toBe(true);
    expect(result.drafts.find((skill) => skill.id === 'document-review')?.instructions).toContain('Validate and summarize findings.');
  });

  it('reuses an existing skill instead of creating a duplicate', () => {
    const existing = createSkill({ id: 'document-review', name: 'Document review', instructions: 'Existing reviewed instructions.' });
    const result = materializeWorkflowSkillDrafts(validPlan(), [existing]);

    expect(result.drafts.map((skill) => skill.id)).not.toContain('document-review');
    expect(result.plan.nodes.find((node) => node.id === 'report')?.skillIds).toEqual(['document-review']);
  });

  it('does not assign generated skills to non-executable approval nodes', () => {
    const source = validPlan();
    source.nodes.push({ id: 'approve', name: 'Human approval', type: 'approval', prompt: 'Approve the report.', skillIds: [], inputKeys: ['report'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: true });
    const result = materializeWorkflowSkillDrafts(source, []);

    expect(result.plan.nodes.find((node) => node.id === 'approve')?.skillIds).toEqual([]);
  });
});
