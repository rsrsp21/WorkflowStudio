import { DEFAULT_HARNESS_POLICY, WORKFLOW_SCHEMA_VERSION, type WorkflowPlan } from './models';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const STARTERS = [
  ['starter-software-quality', 'Software quality review', 'Software', 'Inspect a software project, identify correctness and maintainability risks, and produce an actionable review.'],
  ['starter-documentation-review', 'Documentation review', 'Documentation', 'Review documentation for completeness, accuracy, clarity, and traceability.'],
  ['starter-research-synthesis', 'Research synthesis', 'Research', 'Synthesize evidence, distinguish facts from inference, and document open questions.'],
  ['starter-compliance-check', 'Compliance check', 'Compliance', 'Assess supplied material against explicit controls and prepare evidence-linked findings.'],
  ['starter-content-pipeline', 'Content production', 'Content', 'Draft, review, and validate content against the supplied brief and publishing criteria.'],
  ['starter-operations-review', 'Operations review', 'Operations', 'Inspect an operating process, identify failure points, and propose validated improvements.']
] as const;

export const STARTER_WORKFLOWS: WorkflowPlan[] = STARTERS.map(([id, name, domain, description]) => ({
  id,
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  name,
  description,
  domain,
  version: 1,
  starter: true,
  planningPrompt: description,
  workspacePath: 'C:\\workflow-studio\\project-selected-at-use-time',
  constraints: ['Keep findings evidence-based.', 'Do not perform destructive actions without approval.'],
  openQuestions: [],
  completionCriteria: ['A validated result and explicit failure outcome are available.'],
  nodes: [
    { id: `${id}-work`, name: 'Perform review', type: 'codex', prompt: description, skillIds: [], inputKeys: ['project'], outputKeys: ['result'], retryLimit: 2, requiresApproval: false },
    { id: `${id}-success`, name: 'Result accepted', type: 'success', prompt: 'Record the accepted result.', skillIds: [], inputKeys: ['result'], outputKeys: ['approved-result'], retryLimit: 0, requiresApproval: false },
    { id: `${id}-failure`, name: 'Review blocked', type: 'failure', prompt: 'Record why the review could not be completed.', skillIds: [], inputKeys: [], outputKeys: ['failure-report'], retryLimit: 0, requiresApproval: false }
  ],
  edges: [
    { from: `${id}-work`, to: `${id}-success`, condition: 'validation passes' },
    { from: `${id}-work`, to: `${id}-failure`, condition: 'validation fails or required context is missing' }
  ],
  harness: { ...DEFAULT_HARNESS_POLICY, allowedTools: [], allowedWorkspacePaths: [] },
  status: 'draft',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT
}));
