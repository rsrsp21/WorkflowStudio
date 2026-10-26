import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ExecutionModelSettings from '@/src/components/execution-model-settings';
import Phase3GraphEditor from '@/src/components/phase3-graph-editor';
import { companionDefaultModel } from '@/src/domain/model-settings';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { draftWorkflowPlan, validateWorkflowGraph } from '@/src/domain/models';

describe('companion model selection and graph approval', () => {
  const models = ['gpt-5.6-terra', 'gpt-5.6-luna'];

  it('chooses an available default without assuming Sol is supported', () => {
    expect(companionDefaultModel(models, 'gpt-5.6-sol')).toBe('gpt-5.6-terra');
    expect(companionDefaultModel(models, 'gpt-5.6-luna')).toBe('gpt-5.6-luna');
    expect(companionDefaultModel([])).toBeUndefined();
  });

  it('clears stale definition approval when model or harness settings change', () => {
    const approved = structuredClone(STARTER_WORKFLOWS[0]);
    approved.status = 'approved';
    approved.definitionApproval = { approvedAt: new Date().toISOString(), approvedBy: { id: 'builder', name: 'Builder', role: 'builder' }, workflowVersion: approved.version ?? 1 };
    const broken = { ...approved, status: 'draft' as const, modelSettings: { model: 'gpt-5.6-luna' } };
    expect(validateWorkflowGraph(broken).errors).toContain('Only an approved workflow may retain definition approval metadata.');
    const edited = draftWorkflowPlan(broken);
    expect(edited.definitionApproval).toBeUndefined();
    expect(validateWorkflowGraph(edited).errors).toEqual([]);
    expect(approved.definitionApproval).toBeDefined();
  });

  it('lists runtime models and flags an existing unavailable choice', () => {
    const html = renderToStaticMarkup(<ExecutionModelSettings id="test" settings={{ model: 'gpt-5.6-sol' }} availableModels={models} onChange={vi.fn()} />);
    expect(html).toContain('gpt-5.6-sol (unavailable in companion)');
    expect(html).toContain('value="gpt-5.6-luna"');
    expect(html).not.toContain('gpt-6-astra');
  });

  function render(blocked = false) {
    const workflow = structuredClone(STARTER_WORKFLOWS[0]);
    workflow.modelSettings = { model: 'gpt-5.6-luna', reasoningEffort: 'medium' };
    if (blocked) workflow.completionCriteria = [];
    return renderToStaticMarkup(<Phase3GraphEditor workflow={workflow} skills={[]} availableModels={models} onBack={vi.fn()} onSave={vi.fn()} onApprove={vi.fn()} onOpenSkill={vi.fn()} onCreateSkill={vi.fn()} onAddSkill={vi.fn()} />);
  }

  it('allows approval of a valid graph using Luna', () => {
    expect(render()).not.toContain('id="graph-approval-blockers"');
    expect(render()).toMatch(/<button class="dash-button primary" type="button">Approve graph<\/button>/);
  });

  it('keeps real validation blockers visible beside the approval action', () => {
    const html = render(true);
    expect(html).toContain('id="graph-approval-blockers"');
    expect(html).toContain('Approval blocked:');
    expect(html).toContain('aria-describedby="graph-approval-blockers"');
  });
});
