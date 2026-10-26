import { assertStudioProject, ensureStudioHome, studioRuntimeEnvironment } from '@/scripts/studio-home.cjs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { validateWorkflowPlan, type WorkflowPlan } from '@/src/domain/models';
import type { PlanningRequest, PlanningResult } from '@/src/domain/planning';
import type { CodexAdapter, CodexCliEvent, CodexFocusedTaskRequest, CodexFocusedTaskResult } from './codex-adapter';
import { buildFocusedTaskPrompt, parseFocusedTaskMessage, prepareFocusedTaskArtifacts } from './focused-task';
import { assertRuntimeWorkspaceBoundary } from '@/src/domain/workspace-boundary';

export function buildFocusedTaskCliArgs(request: CodexFocusedTaskRequest, schemaFile: string, outputFile: string): string[] {
  const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
  return ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--model', request.modelSettings.model, '-c', `model_reasoning_effort=${request.modelSettings.reasoningEffort}`, ...(request.modelSettings.verbosity ? ['-c', `model_verbosity=${request.modelSettings.verbosity}`] : []), '--sandbox', boundary.sandbox, '--output-schema', schemaFile, '--output-last-message', outputFile, '-C', boundary.rootPath, buildFocusedTaskPrompt(request)];
}
import { resolveCodexInvocation } from './codex-runtime';

function failure(code: 'PROVIDER_FAILURE' | 'TIMEOUT' | 'MALFORMED_RESPONSE' | 'INVALID_PLAN', message: string, planningRequestId: string, planningThreadId?: string): PlanningResult {
  return { ok: false, error: { code, message, trace: { planningRequestId, ...(planningThreadId ? { planningThreadId } : {}) } } };
}

function findThreadId(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const candidate = value.thread_id ?? value.threadId ?? (value.thread as Record<string, unknown> | undefined)?.id;
      if (typeof candidate === 'string') return candidate;
    } catch { /* Ignore non-JSON CLI lines. */ }
  }
  return undefined;
}

export function buildPlanningPrompt(request: PlanningRequest): string {
  const isGraphRepair = Boolean(request.previousPlan && request.graphRepairFeedback?.length);
  const isRevision = Boolean(request.previousPlan && request.questionResponses?.length);
  return [
    'You are the Workflow Studio planning engine.',
    'Planning only: do not execute commands, modify files, or claim that execution has started.',
    'Workflows execute in the project selected at assignment time. For file creation or editing, declare requiredArtifacts and file validation criteria on the producing nodes and require an approved workspace-write assignment. Package real project files for review; a JSON description or private-cache path is not a completed file deliverable. Read-only analysis and API-only steps may return structured results without creating files.',
    'Return only valid JSON matching this envelope: {"plan": WorkflowPlan, "warnings": string[], "openQuestions": string[], "trace": {"planningRequestId": string, "planningThreadId": string, "planId": string}}.',
    'Preserve the planning prompt and workspace path exactly. Set the plan status to draft.',
    'Use only exact availableSkills ids when attaching an installed or published skill to plan.nodes[].skillIds. Attach every skill whose declared capability is required by that node. For example, image or UI-screen generation must include an available image-generation skill; do not replace an available capability with a made-up skill id.',
    'If no available skill covers a node-specific capability, you may propose a concise new skill id for later review.',
    'Before returning the graph, verify its data flow. Every node input must be produced by an earlier reachable node, carried by an explicit bounded loop-back path, or be a true project-assignment input that no node produces. Never require an output from a future or optional branch. Do not list optional context as a required input; either provide a default on every incoming path or describe it as optional in the node instructions. Entry-node inputs may be normalized and emitted by that same entry node.',
    'Give every output key one clear producer. For revision cycles, prefer distinct initial and revised output keys followed by one merge or selection step that emits the canonical latest value. Never make a first-pass node require data that exists only after a loop. A bounded loop may intentionally update an existing state key only when the producer steps are sequential within that revision cycle.',
    'Ensure every node is reachable, every non-terminal path continues, terminal nodes have no outgoing connections, cycles return only from bounded loop nodes, and both success and failure outcomes are reachable.',
    'Parallel execution supports maxConcurrentNodes from 1 to 10. A fork control node has unconditional outgoing edges and no outputs, skills, or approval; a join control node emits exactly one object with branch status/output/error records and has no skills or approval. Use joinMode all for full collection, or quorum with an explicit joinQuorum to accept N successful branches and discard unfinished branches. Set joinMode all and joinQuorum 1 on non-join nodes. Mark readOnly true only for steps needing no project writes; their sandbox is downgraded. Project-wide write tasks are exclusive and cannot overlap other tasks. Set parallelFailureMode fail-fast or collect-all explicitly; collected failures must be inspected at a join and, where appropriate, a human gate. Approvals and bounded-loop resets remain barriers. Never parallelize data-dependent tasks or claim unsafe shared writes are isolated.',
    'Use at most one edge per source/target pair, even when conditions differ. Keep approval acceptance paths forward-only: produce or select the candidate before its approval, then continue to success after acceptance. Revised candidates must return to approval through a bounded revision path. Verify that removing every loop-node return edge leaves no cycle; a separate bounded loop does not protect a selector/approval cycle that bypasses it.',
    'For every approval node, populate approvalOptions with clear user-facing outcomes. Each option has a unique id, label, custom keyword, and action (continue, revise, or stop). A continue or revise keyword must exactly match one outgoing edge condition. Do not assume approvals must use yes/no; preserve user-requested words such as continue, revise, regenerate, or ship. Route revision outcomes through a bounded loop node.',
    'Quality reviews are evidence-producing steps, not autonomous perfection loops. Check the approved criteria once per attempt, distinguish material problems from cosmetic preferences, and present findings and real artifacts to a human gate before discretionary rework. In UI/screen/visual consistency flows, always route the review to a human decision with continue using the current screens, revise selected screens, and stop outcomes; never route subjective consistency findings directly to regeneration or failure. Human acceptance records tradeoffs rather than requiring pixel-perfect consistency. Preserve accepted artifacts and revise only the requested items. Missing files, invalid contracts, permission boundaries, security and mandatory compliance controls remain hard checks.',
    'Keep the human review gate reachable after every revision, including the last permitted attempt. A revision limit restricts the revise option, not the continue or stop options. At that gate explain the remaining revision budget; require an explicit settings change to increase it. Do not enter an exhausted loop automatically or silently increase the limit.',
    'Distinguish recoverable deliverable defects from unrecoverable failures. For repairable file naming, manifest mapping, or contract defects, include a targeted repair and revalidation route with appropriate approvals rather than requiring a complete workflow restart. Preserve valid deliverables; do not regenerate a whole set to correct labels. Never bypass a mandatory validation, invent missing evidence, or perform unapproved repairs.',
    'When the request describes product planning and UI delivery, make the graph explicitly reachable from requirements to design, technology-stack decision, frontend architecture, backend architecture, architecture diagrams, UI screens, implementation phases, and final review. Include configured approval outcomes for PROVIDE STACK, RECOMMEND STACK, COMPARE OPTIONS and DESKTOP, MOBILE, BOTH whenever those choices are requested; do not hide these decisions in node text.',
    'Set harness.adaptationEnabled to false and harness.adaptationScope to run unless the user explicitly requests opt-in improvement capture. Adaptation may only propose a future version and may never rewrite an active workflow or skill.',
    isGraphRepair ? `This is an automatic graph-contract repair pass. Correct every supplied issue in previousPlan while preserving the user intent, answered questions, stages, approvals, and expected outputs. Return a complete replacement plan, not a patch. Repair feedback:\n${request.graphRepairFeedback?.map((issue) => `- ${issue}`).join('\n')}` : isRevision ? 'This is a revision pass. Treat questionResponses as authoritative context, revise the previousPlan, and remove every resolved question. Return only genuinely unresolved or newly discovered questions. Do not repeat an answered question unchanged. Preserve all submitted questionResponses in plan.questionResponses.' : 'Ask precise open questions for any ambiguity that could materially change the graph, required skills, permissions, decisions, or outputs.',
    'Return an empty openQuestions array only when the workflow is sufficiently resolved for library creation.',
    `Planning request:\n${JSON.stringify(request, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function parsePlanningMessage(raw: string, planningRequestId: string, planningThreadId?: string): PlanningResult {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(cleaned) as Record<string, unknown>; } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return failure('MALFORMED_RESPONSE', 'Codex CLI returned invalid JSON for the planning response.', planningRequestId, planningThreadId);
    try { parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>; } catch { return failure('MALFORMED_RESPONSE', 'Codex CLI returned invalid JSON for the planning response.', planningRequestId, planningThreadId); }
  }

  const value = parsed.plan ? parsed : { plan: parsed, warnings: [], openQuestions: [], trace: {} };
  const plan = value.plan;
  const planErrors = validateWorkflowPlan(plan);
  const responseErrors = [
    !Array.isArray(value.warnings) ? 'Planning response must contain a warnings array.' : '',
    !Array.isArray(value.openQuestions) ? 'Planning response must contain an openQuestions array.' : '',
    ...planErrors
  ].filter(Boolean);
  if (responseErrors.length) {
    return failure('INVALID_PLAN', responseErrors.join(' '), planningRequestId, planningThreadId);
  }
  const workflowPlan = plan as WorkflowPlan;
  return { ok: true, value: { plan: workflowPlan, warnings: value.warnings as string[], openQuestions: value.openQuestions as string[], trace: { planningRequestId, planningThreadId: planningThreadId ?? (value.trace as Record<string, unknown>)?.planningThreadId as string ?? 'unknown', planId: workflowPlan.id } } };
}

export class CodexCliAdapter implements CodexAdapter {
  constructor(private readonly spawnProcess: typeof spawn = spawn) {}

  async createPlanningThread(request: PlanningRequest, onEvent?: (event: CodexCliEvent) => void): Promise<PlanningResult> {
    const planningRequestId = `planning_${crypto.randomUUID()}`;
    try { assertStudioProject(request.workspacePath); } catch (error) { return failure('INVALID_PLAN', error instanceof Error ? error.message : 'Project is outside Workflow Studio.', planningRequestId); }
    const tempDirectory = await mkdtemp(path.join(ensureStudioHome().temporary, 'workflow-studio-'));
    const outputFile = path.join(tempDirectory, 'last-message.txt');
    const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS ?? 120000);
    const prompt = buildPlanningPrompt(request);

    return new Promise<PlanningResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = async (result: PlanningResult) => {
        if (settled) return;
        settled = true;
        await rm(tempDirectory, { recursive: true, force: true });
        resolve(result);
      };
      const schemaFile = path.join(process.cwd(), 'src', 'adapters', 'planning-response.schema.json');
      const cliArgs = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--model', request.executionSettings.planningModel, '-c', `model_reasoning_effort=${request.executionSettings.planningReasoningEffort}`, '--sandbox', 'read-only', '--output-schema', schemaFile, '--output-last-message', outputFile, '-C', request.workspacePath, prompt];
      const { executable, args } = resolveCodexInvocation(cliArgs);
      const runtimeEnvironment = studioRuntimeEnvironment();
      const child = this.spawnProcess(executable, args, { cwd: assertStudioProject(request.workspacePath), shell: false, windowsHide: true, env: runtimeEnvironment });
      const timer = setTimeout(() => { child.kill(); void finish(failure('TIMEOUT', 'Codex CLI planning request timed out.', planningRequestId, findThreadId(stdout))); }, timeoutMs);
      let eventBuffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        eventBuffer += chunk.toString();
        const lines = eventBuffer.split(/\r?\n/);
        eventBuffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            onEvent?.({ type: typeof event.type === 'string' ? event.type : 'cli.output', message: typeof event.message === 'string' ? event.message : undefined, threadId: typeof event.thread_id === 'string' ? event.thread_id : undefined, stream: 'stdout', raw: line });
          } catch { onEvent?.({ type: 'cli.output', message: line.slice(0, 240), stream: 'stdout', raw: line }); }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString(); stderr += text;
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          if (line.trim() === 'Reading additional input from stdin...') continue;
          onEvent?.({ type: 'cli.stderr', message: line.slice(0, 500), stream: 'stderr', raw: line });
        }
      });
      child.on('error', (error) => { clearTimeout(timer); void finish(failure('PROVIDER_FAILURE', `Could not start Codex CLI: ${error.message}`, planningRequestId)); });
      child.on('close', async (code) => {
        clearTimeout(timer);
        const planningThreadId = findThreadId(stdout);
        if (code !== 0) { await finish(failure('PROVIDER_FAILURE', stderr.trim() || `Codex CLI exited with code ${code ?? 'unknown'}.`, planningRequestId, planningThreadId)); return; }
        let raw: string;
        try { raw = (await readFile(outputFile, 'utf8')).trim(); } catch { await finish(failure('MALFORMED_RESPONSE', 'Codex CLI did not produce a final planning message.', planningRequestId, planningThreadId)); return; }
        await finish(parsePlanningMessage(raw, planningRequestId, planningThreadId));
      });
      // The prompt is passed as the final argument. Close stdin so Codex does
      // not wait for additional piped input.
      child.stdin.end();
    });
  }

  async runFocusedTask(request: CodexFocusedTaskRequest) {
    assertStudioProject(request.workspacePath);
    const deliverables = await prepareFocusedTaskArtifacts(request);
    const tempDirectory = await mkdtemp(path.join(ensureStudioHome().temporary, 'workflow-studio-task-'));
    const outputFile = path.join(tempDirectory, 'last-message.txt');
    const timeoutMs = Number(process.env.CODEX_EXECUTION_TIMEOUT_MS ?? process.env.CODEX_TIMEOUT_MS ?? 120000);
    const schemaFile = path.join(process.cwd(), 'src', 'adapters', 'focused-task-response.schema.json');
    const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
    const cliArgs = buildFocusedTaskCliArgs(request, schemaFile, outputFile);
    const { executable, args } = resolveCodexInvocation(cliArgs);
    const runtimeEnvironment = studioRuntimeEnvironment();

    return new Promise<CodexFocusedTaskResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = async (error?: Error) => {
        if (settled) return;
        settled = true;
        await rm(tempDirectory, { recursive: true, force: true });
        if (error) reject(error);
      };
      const child = spawn(executable, args, { cwd: assertStudioProject(boundary.rootPath), shell: false, windowsHide: true, env: runtimeEnvironment });
      const timer = setTimeout(() => { child.kill(); void finish(new Error('Codex focused task timed out.')); }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => { clearTimeout(timer); void finish(new Error(`Could not start Codex CLI: ${error.message}`)); });
      child.on('close', async (code) => {
        clearTimeout(timer);
        if (settled) return;
        if (code !== 0) { await finish(new Error(stderr.trim() || `Codex CLI exited with code ${code ?? 'unknown'}.`)); return; }
        let raw: string;
        try { raw = (await readFile(outputFile, 'utf8')).trim(); } catch { await finish(new Error('Codex CLI did not produce a focused-task result.')); return; }
        try {
          const result = parseFocusedTaskMessage(await deliverables.finish(raw), request, findThreadId(stdout));
          settled = true;
          await rm(tempDirectory, { recursive: true, force: true });
          resolve(result);
        } catch (error) {
          await finish(error instanceof Error ? error : new Error('Codex focused-task response was invalid.'));
        }
      });
      child.stdin.end();
    });
  }
}
