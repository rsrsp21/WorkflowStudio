import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Phase3GraphEditor from '@/src/components/phase3-graph-editor';
import ProfileMenu from '@/src/components/profile-menu';
import UiIcon from '@/src/components/ui-icon';
import type { NodeType } from '@/src/domain/models';
import { graphEdgePath, layoutWorkflowGraph } from '@/src/domain/graph-layout';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { validPlan } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe('workflow graph visual language', () => {
  it('renders semantic icons, accessible type labels, distinct shape classes, and separate execution setup', () => {
    const plan = validPlan();
    const types: NodeType[] = ['agent', 'codex', 'tool', 'validation', 'approval', 'loop', 'success', 'failure'];
    plan.nodes = types.map((type, index) => ({
      id: `${type}-${index}`,
      name: `${type} step`,
      type,
      prompt: `${type} instructions`,
      skillIds: [],
      inputKeys: [],
      outputKeys: [`${type}Output`],
      retryLimit: 0,
      requiresApproval: type === 'approval'
    }));
    plan.edges = [{ from: plan.nodes[0].id, to: plan.nodes[1].id, condition: 'continue' }];

    const html = renderToStaticMarkup(<Phase3GraphEditor
      workflow={plan}
      skills={[]}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onOpenSkill={vi.fn()}
      onCreateSkill={vi.fn()}
      onAddSkill={vi.fn()}
    />);

    for (const type of types) expect(html).toContain(`type-${type}`);
    expect(html).toContain('aria-label="Validation node: validation step"');
    expect(html).toContain('Human approval');
    expect(html).toContain('graph-edge-layer');
    expect(html).toContain('graph-edge related');
    expect(html).toContain('Auto layout');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Fit graph"');
    expect(html).toContain('class="graph-viewport"');
    expect(html).toContain('Manage connections');
    expect(html).not.toContain('Runs when');
    expect(html).toContain('Review node');
    expect(html).toContain('Execution setup');
    expect(html).not.toContain('Choose a project and create an assignment before execution.');
  });

  it('shows name and position in the account menu with profile and sign-out actions', () => {
    const markup = renderToStaticMarkup(<ProfileMenu user={{ id: 'user-1', name: 'Alex Morgan', email: 'alex@example.com', role: 'builder', position: 'Software Developer', createdAt: '2026-01-01T00:00:00.000Z' }} />);
    expect(markup).toContain('Alex Morgan');
    expect(markup).toContain('Software Developer');
    expect(markup).toContain('Profile');
    expect(markup).toContain('Sign out');
    expect(markup).not.toContain('Use light mode');
  });

  it('uses a compact short-tail route arrow instead of a text glyph', () => {
    const markup = renderToStaticMarkup(<UiIcon name="arrow-right" />);
    expect(markup).toContain('M6 12h13m-6-6 6 6-6 6');
    expect(markup).not.toContain('→');
  });

  it('lays out forward stages from left to right and routes loops separately', () => {
    const plan = validPlan();
    plan.nodes.push({ id: 'finish', name: 'Finish', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['report'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false });
    plan.edges.push({ from: 'report', to: 'finish', condition: 'valid' });
    const layout = layoutWorkflowGraph(plan);
    expect(layout.positions.inspect.x).toBeLessThan(layout.positions.report.x);
    expect(layout.positions.report.x).toBeLessThan(layout.positions.finish.x);
    expect(layout.width).toBeGreaterThanOrEqual(920);
    expect(graphEdgePath({ x: 500, y: 100 }, { x: 100, y: 200 }, 0, 600)).toContain('C');
  });

  it('groups loop-only values into one non-blocking advisory instead of dumping raw warnings', () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    const entry = plan.nodes[0];
    const success = { ...plan.nodes[1], inputKeys: ['inspection'] };
    const failure = plan.nodes[2];
    const decision = { id: 'decision', name: 'Check context', type: 'validation' as const, prompt: 'Check context.', skillIds: [], inputKeys: ['result'], outputKeys: ['contextDecision'], retryLimit: 0, requiresApproval: false };
    const contextLoop = { id: 'context-loop', name: 'Request context', type: 'loop' as const, prompt: 'Request context.', skillIds: [], inputKeys: ['contextDecision'], outputKeys: ['contextResponses'], retryLimit: 0, requiresApproval: false };
    const inspect = { id: 'inspect', name: 'Inspect with context', type: 'agent' as const, prompt: 'Use optional revision context.', skillIds: [], inputKeys: ['contextDecision', 'contextResponses'], outputKeys: ['inspection'], retryLimit: 0, requiresApproval: false };
    plan.nodes = [entry, decision, contextLoop, inspect, success, failure];
    plan.edges = [
      { from: entry.id, to: decision.id },
      { from: decision.id, to: inspect.id, condition: 'sufficient' },
      { from: decision.id, to: contextLoop.id, condition: 'missing' },
      { from: contextLoop.id, to: decision.id, condition: 'supplied' },
      { from: contextLoop.id, to: failure.id, condition: 'unresolved' },
      { from: inspect.id, to: success.id, condition: 'accepted' },
      { from: inspect.id, to: failure.id, condition: 'blocked' }
    ];

    const html = renderToStaticMarkup(<Phase3GraphEditor workflow={plan} skills={[]} onBack={vi.fn()} onSave={vi.fn()} onApprove={vi.fn()} onOpenSkill={vi.fn()} onCreateSkill={vi.fn()} onAddSkill={vi.fn()} />);
    expect(html).toContain('Definition ready');
    expect(html).toContain('1 non-blocking advisory');
    expect(html).toContain('Revision-cycle context');
    expect(html).not.toContain('only after a loop');
  });
});
