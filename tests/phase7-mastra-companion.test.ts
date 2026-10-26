import crypto from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { createProject, createProjectWorkflow, createSkill, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-mastra-companion-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.stubEnv('CODEX_RUNTIME_MODE', 'paired');
  vi.stubEnv('CODEX_EXECUTION_TIMEOUT_MS', '5000');
  vi.resetModules();
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EBUSY') throw error;
  });
});

describe('Phase 7 Mastra companion bridge', () => {
  it('executes a Mastra node through its owning paired runtime with the compiled scope intact', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Companion owner', email: `companion-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    if (!user) throw new Error('Could not create test user.');
    const { createSession, SESSION_COOKIE } = await import('@/src/auth/auth');
    const session = await createSession(user.id);

    const runtimeRepository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await runtimeRepository.createRuntimePairing(user.id);
    const claimed = await runtimeRepository.claimRuntimePairing({ code: pairing.pairingCode, hostname: 'OWNER-PC', allowedRoots: [directory] });
    if (!claimed) throw new Error('Could not pair runtime.');
    await runtimeRepository.heartbeatRuntime(claimed.connection.id, { authMode: 'chatgpt', codexAccountLabel: user.email, companionVersion: '0.2.0' });

    const skill = createSkill({
      id: 'selected-review-skill', name: 'Selected review skill', description: 'Review one document.', instructions: 'Use only the approved evidence.',
      status: 'published', source: 'Installed Codex skill', requiredContext: ['project'], requiredPermissions: ['read-file'], validationCriteria: ['Return a concise result.']
    });
    const plan: WorkflowPlan = {
      id: 'companion-workflow', schemaVersion: 1, version: 1, name: 'Companion workflow', description: 'Execute one scoped node.',
      planningPrompt: 'This planning prompt must not be sent.', workspacePath: directory, constraints: [], openQuestions: [], completionCriteria: ['Result exists.'],
      modelSettings: { verbosity: 'low' },
      nodes: [
        { id: 'review', name: 'Review', type: 'codex', prompt: 'Review the approved project.', skillIds: [skill.id], inputKeys: ['project'], outputKeys: ['result'], outputSchemas: { result: 'string' }, retryLimit: 0, requiresApproval: false },
        { id: 'success', name: 'Success', type: 'success', prompt: 'Record success.', skillIds: [], inputKeys: ['result'], outputKeys: ['final'], outputSchemas: { final: 'string' }, retryLimit: 0, requiresApproval: false },
        { id: 'failure', name: 'Failure', type: 'failure', prompt: 'Record failure.', skillIds: [], inputKeys: ['result'], outputKeys: ['reason'], outputSchemas: { reason: 'string' }, retryLimit: 0, requiresApproval: false }
      ],
      edges: [{ from: 'review', to: 'success', condition: 'accept' }, { from: 'review', to: 'failure', condition: 'stop' }], harness: { sandboxMode: 'read-only', maxRetries: 0, maxLoopIterations: 1, maxConcurrentNodes: 1, allowedTools: ['read-file'], allowedWorkspacePaths: [directory], requireApprovalForDestructiveActions: true },
      status: 'approved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const project = createProject({ id: 'companion-project', name: 'Companion project', rootPath: directory, workspaceKind: 'repository' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
    const assignment = createProjectWorkflow({
      id: 'companion-assignment', project, workflow, status: 'ready', graphOverride: plan, approval: testAssignmentApproval(workflow.version),
      inputOverrides: {}, selectedSkills: [skill],
      permissions: { sandboxMode: 'read-only', allowedTools: ['read-file'], allowedWorkspacePaths: [directory], requireApprovalForDestructiveActions: true }
    });

    const { RunRepository } = await import('@/src/storage/run-repository');
    const { CodexNodeExecutor, buildCodexFocusedTaskRequest } = await import('@/src/adapters/codex-node-executor');
    const { PairedCodexRuntimeAdapter } = await import('@/src/adapters/paired-runtime-adapter');
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const runs = new RunRepository();
    const adapter = new LocalMastraAdapter({
      executor: new CodexNodeExecutor(new PairedCodexRuntimeAdapter(user.id), [skill]), store: runs,
      storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_companion`
    });
    const compiled = await adapter.compile(user.id, plan, assignment, [skill], 'run_mastra-companion');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    compiled.run.runtimeInputs = { project: directory };

    const { startNextNode } = await import('@/src/domain/runtime-engine');
    const focused = startNextNode(compiled.run).task;
    if (!focused) throw new Error('Focused task was not created.');
    await runtimeRepository.heartbeatRuntime(claimed.connection.id, { companionVersion: '0.1.0' });
    await expect(new PairedCodexRuntimeAdapter(user.id).runFocusedTask(buildCodexFocusedTaskRequest(focused, [skill]))).rejects.toThrow('0.1.1');
    await runtimeRepository.heartbeatRuntime(claimed.connection.id, { companionVersion: '0.2.0' });

    const execution = adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    let leased = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    for (let attempt = 0; !leased && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      leased = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    }
    if (!leased?.leaseId) throw new Error('Mastra did not dispatch a companion job.');
    const activeRun = await runs.read(user.id, compiled.run.id);
    expect(activeRun?.nodeRuns.find((node) => node.nodeId === plan.nodes[0].id)?.status).toBe('running');
    expect(leased).toMatchObject({ userId: user.id, connectionId: claimed.connection.id, kind: 'focused-task', status: 'leased' });
    expect(leased.payload).toMatchObject({
      cwd: directory, permission: 'read-only', sandbox: 'read-only', requireRuntimeApprovals: true, allowedTools: ['read-file'], serviceName: 'workflow_studio_execution',
      modelSettings: { verbosity: 'low' },
      metadata: { workflow_studio_run_id: compiled.run.id, workflow_studio_task_id: `${compiled.run.id}:review`, workflow_studio_node_id: 'review' }
    });
    const prompt = String((leased.payload as { prompt?: unknown }).prompt ?? '');
    expect(prompt).toContain('Use only the approved evidence.');
    expect(prompt).toContain(`"project": "${directory.replaceAll('\\', '\\\\')}"`);
    expect(prompt).toContain('"allowedTools": [');
    expect(prompt).not.toContain(plan.planningPrompt);

    const artifactPath = path.join(directory, 'review.md');
    await writeFile(artifactPath, '# Approved review\n', 'utf8');
    const raw = JSON.stringify({
      outputs: [{ key: 'result', valueJson: JSON.stringify('approved') }], selectedCondition: 'accept', summary: 'Review completed.', artifacts: [{ path: artifactPath, description: 'Approved review' }],
      trace: { runId: compiled.run.id, taskId: `${compiled.run.id}:review`, sourcePlanId: plan.id, workflowId: workflow.id, assignmentId: assignment.id, projectId: project.id, nodeId: 'review' }
    });
    expect(await runtimeRepository.completeRuntimeJob(claimed.connection.id, leased.id, leased.leaseId, { result: { raw, providerThreadId: 'thread-companion' } })).toBe(true);
    let terminalJob = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    for (let attempt = 0; !terminalJob && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      terminalJob = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    }
    if (!terminalJob?.leaseId) throw new Error('Mastra did not dispatch the selected terminal node.');
    expect(terminalJob.payload).toMatchObject({ metadata: { workflow_studio_node_id: 'success' } });
    const terminalRaw = JSON.stringify({
      outputs: [{ key: 'final', valueJson: JSON.stringify('done') }], selectedCondition: '', summary: 'Success recorded.', artifacts: [],
      trace: { runId: compiled.run.id, taskId: `${compiled.run.id}:success`, sourcePlanId: plan.id, workflowId: workflow.id, assignmentId: assignment.id, projectId: project.id, nodeId: 'success' }
    });
    expect(await runtimeRepository.completeRuntimeJob(claimed.connection.id, terminalJob.id, terminalJob.leaseId, { result: { raw: terminalRaw, providerThreadId: 'thread-companion-success' } })).toBe(true);
    await expect(execution).resolves.toMatchObject({ status: 'success' });
    const saved = await runs.read(user.id, compiled.run.id);
    expect(saved).toMatchObject({ status: 'completed', mastra: { status: 'completed' } });
    expect(saved?.nodeRuns.find((node) => node.nodeId === 'review')).toMatchObject({ nodeId: 'review', status: 'completed', output: { result: 'approved' }, providerThreadId: 'thread-companion' });
    expect(saved?.nodeRuns.find((node) => node.nodeId === 'review')).toMatchObject({ runtimeJobId: leased.id, runtimeConnectionId: claimed.connection.id });

    const artifact = saved?.artifacts[0];
    if (!artifact) throw new Error('Expected a reviewable artifact.');
    const artifactRoute = await import('@/src/app/api/runs/[runId]/artifacts/[artifactId]/route');
    const preview = artifactRoute.GET(new Request(`http://localhost/api/runs/${compiled.run.id}/artifacts/${artifact.id}`, { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } }), { params: Promise.resolve({ runId: compiled.run.id, artifactId: artifact.id }) });
    let artifactJob = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    for (let attempt = 0; !artifactJob && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      artifactJob = await runtimeRepository.leaseNextRuntimeJob(claimed.connection.id);
    }
    if (!artifactJob?.leaseId) throw new Error('Artifact preview was not routed to the companion.');
    expect(artifactJob).toMatchObject({ kind: 'artifact-read', payload: { path: artifactPath, rootPath: directory, runId: compiled.run.id, artifactId: artifact.id } });
    const artifactContent = Buffer.from('# Approved review\n');
    await runtimeRepository.completeRuntimeJob(claimed.connection.id, artifactJob.id, artifactJob.leaseId, { result: { artifact: { contentBase64: artifactContent.toString('base64'), size: artifactContent.byteLength } } });
    const previewResponse = await preview;
    expect(previewResponse.status).toBe(200);
    expect(await previewResponse.text()).toBe('# Approved review\n');
    await adapter.close();
  }, 60_000);
});
