import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkflowNodeSummary, { humanizeWorkflowLabel } from '@/src/components/workflow-node-summary';
import type { WorkflowNode } from '@/src/domain/models';
import type { Skill } from '@/src/domain/workspace';

const node: WorkflowNode = {
  id: 'internal_node_42',
  name: 'Validate source evidence',
  type: 'validation',
  prompt: 'Check each requirement against authoritative source evidence.',
  skillIds: ['skill_internal_99'],
  inputKeys: ['requirementsSources', 'supporting_context'],
  outputKeys: ['validatedEvidence'],
  retryLimit: 1,
  requiresApproval: false
};

describe('workflow node summary', () => {
  it('turns internal workflow data into a visual, human-readable step', () => {
    const skill = { id: 'skill_internal_99', name: 'Evidence validation', status: 'published' } as Skill;
    const html = renderToStaticMarkup(<WorkflowNodeSummary node={node} index={1} skills={[skill]} variant="step" />);

    expect(html).toContain('Validation');
    expect(html).toContain('Purpose');
    expect(html).toContain('Receives');
    expect(html).toContain('Produces');
    expect(html).toContain('Requirements Sources');
    expect(html).toContain('Supporting context');
    expect(html).toContain('Validated Evidence');
    expect(html).toContain('Evidence validation');
    expect(html).toContain('Ready');
    expect(html).not.toContain('internal_node_42');
    expect(html).not.toContain('skill_internal_99');
  });

  it('explains when a reusable skill will be created instead of saying no skills', () => {
    const html = renderToStaticMarkup(<WorkflowNodeSummary node={{ ...node, skillIds: [] }} index={0} />);
    expect(html).toContain('Validate source evidence skill');
    expect(html).toContain('Will be created');
    expect(html).not.toContain('No skills');
  });

  it('humanizes camel case and machine separators', () => {
    expect(humanizeWorkflowLabel('traceabilityTargetSources')).toBe('Traceability Target Sources');
    expect(humanizeWorkflowLabel('approval-ready_summary')).toBe('Approval ready summary');
  });
});
