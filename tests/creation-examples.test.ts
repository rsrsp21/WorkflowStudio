import { describe, expect, it } from 'vitest';
import { SKILL_CREATION_EXAMPLES, WORKFLOW_CREATION_EXAMPLES } from '@/src/domain/creation-examples';

describe('creation examples', () => {
  it('provides at least eight complete workflow examples', () => {
    expect(WORKFLOW_CREATION_EXAMPLES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(WORKFLOW_CREATION_EXAMPLES.map((example) => example.id)).size).toBe(WORKFLOW_CREATION_EXAMPLES.length);
    for (const example of WORKFLOW_CREATION_EXAMPLES) {
      expect(example.name.trim()).not.toBe('');
      expect(example.objective.trim()).not.toBe('');
      expect(example.stages.split('\n').length).toBeGreaterThanOrEqual(3);
      expect(example.outputs.trim()).not.toBe('');
    }
  });

  it('includes an editable multi-skill product-planning workflow with staged approval loops', () => {
    const example = WORKFLOW_CREATION_EXAMPLES.find((candidate) => candidate.id === 'product-planning-delivery');
    expect(example).toBeDefined();
    expect(example?.stages).toContain('common-requirements-generator');
    expect(example?.stages).toContain('common-ui-screen-generator');
    expect(example?.stages).toContain('implementation phases');
    expect(example?.approvals).toContain('REVISE REQUIREMENTS');
    expect(example?.approvals).toContain('REGENERATE SCREENS');
    expect(example?.approvals).toContain('PROVIDE STACK');
    expect(example?.approvals).toContain('RECOMMEND STACK');
    expect(example?.approvals).toContain('COMPARE OPTIONS');
    expect(example?.approvals).toContain('DESKTOP, MOBILE, BOTH');
    expect(example?.constraints).toContain('generic and editable');
  });

  it('provides at least eight complete skill examples', () => {
    expect(SKILL_CREATION_EXAMPLES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SKILL_CREATION_EXAMPLES.map((example) => example.id)).size).toBe(SKILL_CREATION_EXAMPLES.length);
    for (const example of SKILL_CREATION_EXAMPLES) {
      expect(example.name.trim()).not.toBe('');
      expect(example.instructions.trim()).not.toBe('');
      expect(example.inputs.trim()).not.toBe('');
      expect(example.outputs.trim()).not.toBe('');
      expect(example.validationCriteria.trim()).not.toBe('');
      expect(example.estimatedContextTokens).toBeGreaterThan(0);
    }
  });

  it('gives all workflow examples user-controlled quality revisions and project delivery rules', () => {
    for (const example of WORKFLOW_CREATION_EXAMPLES) {
      expect(example.approvals).toContain('before any bounded revision loop');
      expect(example.approvals).toContain('continue with recorded tradeoffs');
      expect(example.approvals).toContain('revision limit');
      expect(example.constraints).toContain('selected project folder');
      expect(example.constraints).toContain('once per attempt');
      expect(example.constraints).toContain('cannot bypass missing files');
    }
  });

  it('makes UI consistency advisory rather than a forced regeneration loop', () => {
    const workflow = WORKFLOW_CREATION_EXAMPLES.find((example) => example.id === 'ui-screen-generation')!;
    expect(workflow.approvals).toContain('CONTINUE WITH SCREENS, REVISE SELECTED SCREENS, and STOP');
    expect(workflow.constraints).toContain('never automatically regenerate');
    expect(workflow.constraints).toContain('not pixel-perfect');
    const skill = SKILL_CREATION_EXAMPLES.find((example) => example.id === 'ui-screen-generator')!;
    expect(skill.instructions).toContain('Never regenerate automatically');
    expect(skill.requiredPermissions).toContain('workspace.write');
    expect(skill.validationCriteria).not.toContain('Shared components remain consistent');
  });
});
