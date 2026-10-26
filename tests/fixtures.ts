import type { PlanningResponse } from '@/src/domain/planning';
import type { WorkflowPlan } from '@/src/domain/models';

export function validPlan(): WorkflowPlan {
  return {
    id: 'plan-1', schemaVersion: 1, name: 'Document review', description: 'Review documents and report findings.',
    planningPrompt: 'Review the selected project documents.', workspacePath: 'C:\\projects\\documents', constraints: ['Do not modify source files.'],
    openQuestions: ['Which report format is preferred?'], completionCriteria: ['Findings are documented.'],
    nodes: [
      { id: 'inspect', name: 'Inspect files', type: 'codex', prompt: 'Inspect the documents.', skillIds: [], inputKeys: ['workspace'], outputKeys: ['inventory'], retryLimit: 1, requiresApproval: false },
      { id: 'report', name: 'Create report', type: 'validation', prompt: 'Validate and summarize findings.', skillIds: ['document-review'], inputKeys: ['inventory'], outputKeys: ['report'], retryLimit: 1, requiresApproval: false }
    ],
    edges: [{ from: 'inspect', to: 'report', condition: 'inventory available' }],
    harness: { sandboxMode: 'read-only', maxRetries: 2, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\documents'], requireApprovalForDestructiveActions: true },
    status: 'draft', createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z'
  };
}

export function validResponse(): PlanningResponse {
  return { plan: validPlan(), warnings: ['Report format is not specified.'], openQuestions: ['Which report format is preferred?'], trace: { planningRequestId: 'request-1', planningThreadId: 'thread-1', planId: 'plan-1' } };
}
