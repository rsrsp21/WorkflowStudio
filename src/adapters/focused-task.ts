import type { CodexFocusedTaskRequest, CodexFocusedTaskResult, CodexFocusedTaskTrace } from './codex-adapter';
import { assertRuntimeWorkspaceBoundary, resolveArtifactPath } from '@/src/domain/workspace-boundary';
import { createProjectDeliverables, loadArtifactSourceRoots } from '@/scripts/project-deliverables.cjs';
import { studioPaths } from '@/scripts/studio-home.cjs';
import path from 'node:path';

interface RawFocusedTaskResponse {
  outputs?: unknown;
  selectedCondition?: unknown;
  summary?: unknown;
  artifacts?: unknown;
  trace?: unknown;
}

function expectedTrace(request: CodexFocusedTaskRequest): CodexFocusedTaskTrace {
  return {
    runId: request.runId,
    taskId: request.taskId,
    sourcePlanId: request.sourcePlanId,
    workflowId: request.workflowId,
    assignmentId: request.assignmentId,
    projectId: request.projectId,
    nodeId: request.nodeId
  };
}

export function buildFocusedTaskPrompt(request: CodexFocusedTaskRequest): string {
  const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
  const installedSkillInvocations = request.skills.filter((skill) => skill.source === 'Installed Codex skill').map((skill) => `$${skill.id}`);
  return [
    'You are executing exactly one approved Workflow Studio node.',
    'Perform only the focused node instructions below. Do not request, reconstruct, or use the original workflow planning prompt.',
    'Operate only inside the supplied workspace and harness boundaries. Never broaden permissions or perform an action that requires an unavailable approval.',
    'The assigned project root is the working directory for every task. Edit existing project files in place when requested; preserve unrelated files. Resolve relative paths from this project root, never from the application install folder or your private runtime home.',
    'For every file you create or modify, return its real path and a useful label in artifacts, even when requiredArtifactLabels is empty. Verify that each reported file exists. The artifacts array is the explicit file manifest; filenames mentioned only in prose or output fields are not delivered files. For tool-produced files, report exact paths in this manifest and outputs. Files outside the project can be delivered only from source folders explicitly configured by the local runtime operator. Do not invent file paths or claim that a file was saved without creating it.',
    'Verify each artifact identity against its actual content and declared purpose. Never assign filenames or IDs from directory enumeration order, modification times, or an assumed tool-result ordering. Maintain an explicit source-to-deliverable mapping as files are produced. Report mismatches precisely; preserve existing files and do not regenerate unrelated deliverables.',
    boundary.writeAllowed ? 'Project writes are approved for this step. Prefer creating and editing files directly in the assigned project. Declared files from approved external artifact sources are copied under artifacts/<run>/<node>/ inside this project; preserve the returned project paths in later steps.' : 'This step is read-only. Do not edit project files or generate deliverables that require project writes. Report an actionable permission blocker if the requested work requires writing.',
    'Use the selected skill instructions when they apply to this node. Do not invoke or invent unselected skills.',
    'Evaluate skill validation criteria only within the current node instructions, declared inputs, and required outputs/artifacts. Workflow completion criteria and checks for downstream deliverables or later human approvals are not prerequisites for this node unless its instructions or declared inputs explicitly require them. For shared skills, apply only the criteria for the current node.',
    installedSkillInvocations.length ? `Invoke the selected installed Codex skills for this focused stage: ${installedSkillInvocations.join(' ')}.` : '',
    'Return only JSON matching the supplied output schema. Encode every output value as valid JSON text in outputs[].valueJson. Return each required output key exactly once and no extra output keys.',
    request.edgeConditions.length ? `Select exactly one outgoing condition and return its text unchanged in selectedCondition. Use __default__ only for the unconditional fallback route. Available conditions:\n${JSON.stringify(request.edgeConditions, null, 2)}` : 'Return an empty selectedCondition because this node has no conditional outgoing edges.',
    `Execution identity:\n${JSON.stringify(expectedTrace(request), null, 2)}`,
    `Node:\n${JSON.stringify({ name: request.nodeName, type: request.nodeType, instructions: request.prompt, requiredOutputKeys: request.outputKeys, outputTypes: request.outputSchemas ?? {}, requiredArtifactLabels: request.requiredArtifacts ?? [] }, null, 2)}`,
    `Resolved prior outputs:\n${JSON.stringify(request.input, null, 2)}`,
    `Selected skills:\n${JSON.stringify(request.skills, null, 2)}`,
    request.approvedAdaptations?.length ? `Human-approved improvements from earlier runs. Apply these only to this node and within the current workflow constraints:\n${JSON.stringify(request.approvedAdaptations, null, 2)}` : '',
    `Workspace and harness:\n${JSON.stringify({ ...boundary, harness: request.harness }, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export async function prepareFocusedTaskArtifacts(request: CodexFocusedTaskRequest) {
  const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
  return createProjectDeliverables({ rootPath: boundary.rootPath, writeAllowed: boundary.writeAllowed,
    approvedSourceRoots: await loadArtifactSourceRoots(path.join(studioPaths().home, 'runtime', 'artifact-sources.json')), inputs: request.input,
    trace: expectedTrace(request), attempt: request.attempt, iteration: request.iteration });
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseFocusedTaskMessage(raw: string, request: CodexFocusedTaskRequest, providerThreadId?: string): CodexFocusedTaskResult {
  const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let response: RawFocusedTaskResponse;
  try { response = JSON.parse(cleaned) as RawFocusedTaskResponse; } catch { throw new Error('Codex returned invalid JSON for the focused node output.'); }
  if (!Array.isArray(response.outputs)) throw new Error('Focused node output must contain an outputs array.');
  if (typeof response.summary !== 'string') throw new Error('Focused node output must contain a summary.');
  if (typeof response.selectedCondition !== 'string') throw new Error('Focused node output must contain selectedCondition.');
  if (!Array.isArray(response.artifacts) || response.artifacts.some((item) => !plainObject(item) || typeof item.path !== 'string' || typeof item.description !== 'string')) throw new Error('Focused node output contains invalid artifacts.');
  if (!plainObject(response.trace)) throw new Error('Focused node output must contain execution trace identifiers.');

  const trace = expectedTrace(request);
  for (const [key, expected] of Object.entries(trace)) if (response.trace[key] !== expected) throw new Error(`Focused node trace does not match ${key}.`);

  const output: Record<string, unknown> = {};
  for (const item of response.outputs) {
    if (!plainObject(item) || typeof item.key !== 'string' || typeof item.valueJson !== 'string') throw new Error('Focused node output entry is invalid.');
    if (!request.outputKeys.includes(item.key)) throw new Error(`Focused node returned an unexpected output key: ${item.key}.`);
    if (Object.hasOwn(output, item.key)) throw new Error(`Focused node returned a duplicate output key: ${item.key}.`);
    try { output[item.key] = JSON.parse(item.valueJson); } catch { throw new Error(`Focused node output ${item.key} is not valid JSON text.`); }
  }
  const missing = request.outputKeys.filter((key) => !Object.hasOwn(output, key));
  if (missing.length) throw new Error(`Focused node output is missing required keys: ${missing.join(', ')}.`);
  for (const [key, expected] of Object.entries(request.outputSchemas ?? {})) {
    const value = output[key];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actual !== expected) throw new Error(`Focused node output ${key} must be ${expected}; received ${actual}.`);
  }
  const selectedCondition = response.selectedCondition.trim();
  if (request.edgeConditions.length) {
    const matched = request.edgeConditions.find((condition) => condition.toLowerCase() === selectedCondition.toLowerCase());
    if (!matched) throw new Error(`Focused node selected an unavailable edge condition: ${selectedCondition || '(empty)'}.`);
  } else if (selectedCondition) throw new Error(`Focused node selected an edge condition where none is available: ${selectedCondition}.`);

  const artifacts = (response.artifacts as Array<{ path: string; description: string }>).map((artifact) => ({
    path: resolveArtifactPath(artifact.path, boundary.rootPath),
    description: artifact.description,
    rootPath: boundary.rootPath,
    sandboxMode: request.harness.sandboxMode,
    writeAllowed: boundary.writeAllowed
  }));
  const missingArtifacts = (request.requiredArtifacts ?? []).filter((label) => !artifacts.some((artifact) => artifact.description.trim().toLowerCase() === label.trim().toLowerCase()));
  if (missingArtifacts.length) throw new Error(`Focused node output is missing required artifacts: ${missingArtifacts.join(', ')}.`);

  return {
    output,
    selectedCondition,
    summary: response.summary,
    artifacts,
    trace,
    ...(providerThreadId ? { providerThreadId } : {})
  };
}
