import type { HarnessPolicy } from './models';
import { modelSettingsErrors, supportsModelReasoning, type ModelSettings } from './model-settings';
import { appendRunEvent, type WorkflowRun } from './runtime';
import { isWithinWorkspaceRoot } from './workspace-boundary';
import { executionHarness } from './execution-settings-view';
export { executionHarness, executionModelSettings } from './execution-settings-view';

export function runtimeHarnessErrors(value: unknown, rootPath: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Execution harness must be an object.'];
  const harness = value as HarnessPolicy;
  const errors: string[] = [];
  if (!['read-only', 'workspace', 'isolated'].includes(harness.sandboxMode)) errors.push('Execution sandbox is invalid.');
  if (!Number.isInteger(harness.maxRetries) || harness.maxRetries < 0 || harness.maxRetries > 10) errors.push('Retries must be between 0 and 10.');
  if (!Number.isInteger(harness.maxLoopIterations) || harness.maxLoopIterations < 1 || harness.maxLoopIterations > 100) errors.push('Loop limit must be between 1 and 100.');
  if (!Number.isInteger(harness.maxConcurrentNodes) || harness.maxConcurrentNodes < 1 || harness.maxConcurrentNodes > 10) errors.push('Concurrency must be between 1 and 10.');
  if (harness.parallelFailureMode !== undefined && !['fail-fast', 'collect-all'].includes(harness.parallelFailureMode)) errors.push('Parallel failure mode is invalid.');
  if (!Array.isArray(harness.allowedTools) || harness.allowedTools.length > 100 || harness.allowedTools.some((tool) => typeof tool !== 'string' || !tool.trim()) || new Set(harness.allowedTools).size !== harness.allowedTools.length) errors.push('Allowed tools must be unique, non-empty names (up to 100).');
  if (!Array.isArray(harness.allowedWorkspacePaths) || harness.allowedWorkspacePaths.length !== 1 || typeof harness.allowedWorkspacePaths[0] !== 'string' || !isWithinWorkspaceRoot(harness.allowedWorkspacePaths[0], rootPath) || !isWithinWorkspaceRoot(rootPath, harness.allowedWorkspacePaths[0])) errors.push('Execution settings must retain the approved project root.');
  if (typeof harness.requireApprovalForDestructiveActions !== 'boolean') errors.push('The destructive-action approval setting is required.');
  return errors;
}

export function updateRunExecutionSettings(source: WorkflowRun, settings: { modelSettings: ModelSettings; harness: HarnessPolicy }, actor: { id: string; name: string; role: string }, expectedRevision: number, confirmations: { workspaceWrite?: boolean; destructiveBypass?: boolean } = {}): WorkflowRun {
  const waiting = source.nodeRuns.find((node) => node.status === 'waiting-approval');
  if (source.status !== 'compiled' && !(source.status === 'paused' && waiting && source.approvalRecords.some((approval) => approval.nodeId === waiting.nodeId && !approval.decision && !approval.resumedAt))) throw new Error('Execution settings can change only before execution or at an undecided approval gate.');
  if (source.nodeRuns.some((node) => node.status === 'running')) throw new Error('Wait for the active step before changing execution settings.');
  if ((source.executionConfiguration?.revision ?? 0) !== expectedRevision) throw new Error('Execution settings changed. Reload the current settings before saving.');
  const errors = [...modelSettingsErrors(settings.modelSettings), ...runtimeHarnessErrors(settings.harness, source.rootPath)];
  for (const node of source.compiledWorkflow.nodes) {
    const model = settings.modelSettings.model ?? node.modelSettings.model;
    const effort = settings.modelSettings.reasoningEffort ?? node.modelSettings.reasoningEffort;
    if (!supportsModelReasoning(model, effort)) errors.push(`${model} does not support ${effort} reasoning for ${node.name}.`);
  }
  const previous = executionHarness(source);
  if (settings.harness.sandboxMode === 'workspace' && previous.sandboxMode !== 'workspace' && confirmations.workspaceWrite !== true) errors.push('Confirm workspace write access before changing the sandbox.');
  if (!settings.harness.requireApprovalForDestructiveActions && previous.requireApprovalForDestructiveActions && confirmations.destructiveBypass !== true) errors.push('Confirm disabling destructive-action approval.');
  if (Object.values(source.loopIterations).some((count) => count > settings.harness.maxLoopIterations)) errors.push('Loop limit cannot be lower than iterations already used.');
  if (!actor.id || !actor.name || !actor.role) errors.push('An actor identity is required.');
  if (errors.length) throw new Error(Array.from(new Set(errors)).join(' '));
  const run = structuredClone(source);
  const timestamp = new Date().toISOString();
  run.executionConfiguration = { revision: expectedRevision + 1, modelSettings: structuredClone(settings.modelSettings), harness: structuredClone(settings.harness), updatedAt: timestamp, updatedBy: actor };
  run.updatedAt = timestamp;
  appendRunEvent(run, { type: 'run.settings-updated', timestamp, nodeId: waiting?.nodeId, message: `${actor.name} updated execution settings for future steps (revision ${expectedRevision + 1}).`, data: { before: source.executionConfiguration ?? { modelSettings: {}, harness: source.compiledWorkflow.harness }, after: run.executionConfiguration } });
  return run;
}
