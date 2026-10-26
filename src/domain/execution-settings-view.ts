import type { HarnessPolicy } from './models';
import type { ResolvedModelSettings } from './model-settings';
import type { CompiledWorkflowNode, WorkflowRun } from './runtime';

export function executionHarness(run: WorkflowRun): HarnessPolicy {
  return run.executionConfiguration?.harness ?? run.compiledWorkflow.harness;
}

export function executionModelSettings(run: WorkflowRun, node: CompiledWorkflowNode): ResolvedModelSettings {
  const override = run.executionConfiguration?.modelSettings;
  return { ...node.modelSettings,
    ...(override?.model ? { model: override.model, modelSource: 'run' as const } : {}),
    ...(override?.reasoningEffort ? { reasoningEffort: override.reasoningEffort, reasoningSource: 'run' as const } : {}),
    ...(override?.verbosity ? { verbosity: override.verbosity, verbositySource: 'run' as const } : {})
  };
}
