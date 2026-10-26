export interface ProjectDeliverableContext {
  rootPath: string;
  writeAllowed: boolean;
  approvedSourceRoots?: string[];
  inputs?: Record<string, unknown>;
  baselineSnapshot?: Array<[string, string]>;
  trace: { runId: string; taskId: string; nodeId: string; sourcePlanId?: string; workflowId?: string; assignmentId?: string; projectId?: string };
  attempt?: number;
  iteration?: number;
}
export function createProjectDeliverables(context: ProjectDeliverableContext): Promise<{ snapshot(): Array<[string, string]>; finish(raw: string): Promise<string> }>;
export function loadArtifactSourceRoots(configFile: string): Promise<string[]>;
