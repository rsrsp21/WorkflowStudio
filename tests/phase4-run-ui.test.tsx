import React from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RunSummaryPage from '@/src/components/run-summary-page';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, startNextNode } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function compiledRun() {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.planningPrompt = 'Private planning prompt that must not appear in compiled task UI.';
  const project = createProject({ id: 'ui-project', name: 'UI project', rootPath: 'C:\\projects\\ui', workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'ui-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true } });
  const result = compileWorkflowRun('ui-user', plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  return { run: result.run, planningPrompt: plan.planningPrompt };
}

describe('Phase 4 compilation UI', () => {
  it('renders terminal elapsed time from completion rather than a later metadata update', () => {
    const { run } = compiledRun();
    run.status = 'completed';
    run.createdAt = '2026-10-22T12:00:00.000Z';
    run.updatedAt = '2026-10-22T12:30:00.000Z';
    run.events.push({ id: 'finished', sequence: run.events.length + 1, runId: run.id, type: 'run.completed', timestamp: '2026-10-22T12:01:05.000Z', message: 'Finished.' });
    const html = renderToStaticMarkup(<RunSummaryPage run={run} />);
    expect(html).toContain('<span>Elapsed</span><strong>1m 5s</strong>');
    expect(html).not.toContain('<span>Elapsed</span><strong>30m 0s</strong>');
  });

  it('shows a rejected validation reason and same-run recheck instead of a generic restart instruction', () => {
    const { run } = compiledRun();
    const node = run.compiledWorkflow.nodes[0]; node.type = 'validation';
    const rejected = completeNode(startNextNode(run).run, node.id, { result: 'invalid manifest' }, 'validation fails or required context is missing', undefined, { summary: 'File identities do not match their manifest entries.' }).run;
    const html = renderToStaticMarkup(<RunSummaryPage run={rejected} />);
    expect(html).toContain('File identities do not match their manifest entries.');
    expect(html).toContain('Recheck corrected outputs');
  });
  it('shows a compiled run summary with focused execution available', () => {
    const { run, planningPrompt } = compiledRun();
    const html = renderToStaticMarkup(<RunSummaryPage run={run} />);
    expect(html).toContain('Compiled run');
    expect(html).toContain('Execution identity');
    expect(html).toContain('Compiled node tasks');
    expect(html).toContain('Live workflow graph');
    expect(html).toContain('Assignment inputs before execution');
    expect(html).toContain('C:\\projects\\ui');
    expect(html).toContain('Workflow runner');
    expect(html).toContain('Route decisions');
    expect(html).toContain('Loop usage');
    expect(html).toContain('Artifacts');
    expect(html).toContain('Execution history');
    expect(html).toContain('Run workflow');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Run workflow<\/button>/);
    expect(html).toContain(run.compiledWorkflow.nodes[0].focusedPrompt);
    expect(html).not.toContain(planningPrompt);
  });

  it('shows the requested node inputs and highlights its graph node while waiting', () => {
    const { run } = compiledRun();
    run.pendingInput = { nodeId: run.compiledWorkflow.nodes[0].id, keys: ['rough_product_idea', 'project_context'] };
    const html = renderToStaticMarkup(<RunSummaryPage run={run} />);
    expect(html).toContain('Input needed:');
    expect(html).toContain('rough product idea');
    expect(html).toContain('project context');
    expect(html).toContain('run-graph-node input-required');
    expect(html).toContain('Continue workflow');
  });

  it('connects approved graph compilation to the protected run route', async () => {
    const [graphPage, runRoute, executionControl, executionRoute, recoveryRoute, summaryPage] = await Promise.all([
      readFile(path.join(process.cwd(), 'src/components/workflow-graph-page.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/app/runs/[runId]/page.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/components/run-execution-control.tsx'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/app/api/runs/[runId]/execute/route.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/app/api/runs/[runId]/recover/route.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/components/run-summary-page.tsx'), 'utf8')
    ]);
    expect(graphPage).toContain("fetch('/api/runs'");
    expect(graphPage).toContain('Compile run');
    expect(graphPage).toContain('Unsaved editor changes are not included');
    expect(graphPage).toContain('router.push(`/runs/${encodeURIComponent(result.run.id)}`)');
    expect(runRoute).toContain('requirePageUser()');
    expect(runRoute).toContain('await new RunRepository().read(user.id, runId)');
    expect(executionControl).toContain("'execute' | 'recover'");
    expect(executionControl).toContain('/${route}');
    expect(executionControl).toContain("endpoint === 'revalidate' ? 'retry' : endpoint");
    expect(executionRoute).toContain('getRequestUser(request)');
    expect(executionRoute).toContain('adapter.start(executionRun.mastra.workflowId');
    expect(recoveryRoute).toContain('getRequestUser(request)');
    expect(recoveryRoute).toContain('.recover(user.id, runId)');
    expect(summaryPage).toContain('Review output');
  });
});
