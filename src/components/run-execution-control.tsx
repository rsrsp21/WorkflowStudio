'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowRun, WorkflowRunStatus } from '@/src/domain/runtime';
import { executionProgressToken, NO_EXECUTION_PROGRESS } from '@/src/domain/execution-progress';

export default function RunExecutionControl({ runId, status, active, interrupted, pending, retryable = false, recheckable = false, serverOwned = false, runtimeWaiting = false, inputRequired = false, latestError, autoStartKey = 0, onRunUpdated }: { runId: string; status: WorkflowRunStatus; active: boolean; interrupted: boolean; pending: number; retryable?: boolean; recheckable?: boolean; serverOwned?: boolean; runtimeWaiting?: boolean; inputRequired?: boolean; latestError?: string; autoStartKey?: number; onRunUpdated?: (run: WorkflowRun) => void }) {
  const router = useRouter();
  const [executing, setExecuting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const actionKeys = useRef<Partial<Record<'execute' | 'recover' | 'retry' | 'revalidate', string>>>({});
  const stopRequested = useRef(false);
  const inFlight = useRef(false);
  const continueAfterActiveNode = useRef(false);
  const initialContinuationChecked = useRef(false);
  const consumedAutoStart = useRef(0);
  const [retryAfterUntil, setRetryAfterUntil] = useState(0);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const terminal = ['completed', 'failed', 'cancelled'].includes(status);
  const disabled = serverOwned && status === 'running' || executing || active || inputRequired || terminal || status === 'paused' || pending === 0 || retryAfterUntil > 0;
  const label = executing || serverOwned && status === 'running' ? 'Running workflow…' : inputRequired ? 'Input required' : active ? 'Node running' : status === 'paused' ? 'Decision required' : status === 'completed' ? 'Run completed' : status === 'failed' ? 'Run failed' : status === 'cancelled' ? 'Run cancelled' : 'Run workflow';

  async function post(endpoint: 'execute' | 'recover' | 'retry' | 'revalidate') {
    const idempotencyKey = actionKeys.current[endpoint] ?? crypto.randomUUID();
    actionKeys.current[endpoint] = idempotencyKey;
    const route = endpoint === 'revalidate' ? 'retry' : endpoint;
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey, ...(endpoint === 'revalidate' ? { mode: 'revalidate' } : {}) }) });
    const result = await response.json() as { error?: string; errors?: string[]; run?: WorkflowRun; transition?: { kind?: string; nodeRun?: { error?: string } } };
    if (!response.ok) {
      setAutoReconnect(false);
      if (result.run) onRunUpdated?.(result.run);
      const message = result.errors?.join(' ') || result.error || `The run could not ${endpoint}.`;
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const seconds = header && /^\d+$/.test(header) ? Number(header) : 0;
        const until = seconds ? Date.now() + seconds * 1000 : header ? Date.parse(header) : NaN;
        const deadline = Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60_000;
        setRetryAfterUntil(deadline);
        throw new Error(`${message} Automatic execution has stopped. Retry after ${new Date(deadline).toLocaleTimeString()}. Completed work is saved.`);
      }
      throw new Error(message);
    }
    actionKeys.current[endpoint] = undefined;
    if (result.transition?.kind === 'retried' && endpoint === 'execute') setError('Retrying the step within its approved retry limit…');
    else setError('');
    if (result.run) onRunUpdated?.(result.run);
    if (!onRunUpdated) router.refresh();
    return result;
  }

  async function runUntilGate() {
    if (inFlight.current || retryAfterUntil > Date.now()) return;
    inFlight.current = true;
    continueAfterActiveNode.current = false;
    setAutoReconnect(true);
    setExecuting(true);
    setStopping(false);
    stopRequested.current = false;
    setError('');
    try {
      let previousProgress: string | undefined;
      for (let transitionCount = 0; transitionCount < 1000 && !stopRequested.current; transitionCount += 1) {
        const result = await post('execute');
        const nextRun = result.run;
        if (nextRun?.runtimeWaiting) {
          setError(nextRun.executionRequested ? 'Waiting for your local runtime to reconnect. The server will resume authorized work automatically.' : 'Waiting for your local runtime to reconnect. Execution will resume automatically while this page is open.');
          break;
        }
        if (nextRun?.executionRequested) break;
        if (!nextRun || nextRun.pendingInput || ['paused', 'completed', 'failed', 'cancelled'].includes(nextRun.status)) break;
        if (nextRun.nodeRuns.some((node) => node.status === 'running')) { continueAfterActiveNode.current = true; break; }
        if (nextRun.nodeRuns.some((node) => node.status === 'waiting-approval')) break;
        if (!nextRun.nodeRuns.some((node) => node.status === 'pending')) break;
        const progress = executionProgressToken(nextRun);
        if (progress === previousProgress) throw new Error(NO_EXECUTION_PROGRESS);
        previousProgress = progress;
      }
    } catch (cause) {
      continueAfterActiveNode.current = false;
      setAutoReconnect(false);
      setError(cause instanceof Error ? cause.message : 'The workflow could not continue.');
    } finally {
      inFlight.current = false;
      setExecuting(false);
      setStopping(false);
      stopRequested.current = false;
    }
  }

  async function recover() {
    setExecuting(true);
    setError('');
    try { await post('recover'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The interrupted node could not be recovered.'); }
    finally { setExecuting(false); }
  }

  async function retry(revalidate = false) {
    setExecuting(true); setError('');
    try {
      await post(revalidate ? 'revalidate' : 'retry');
      await runUntilGate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The failed step could not be retried.'); }
    finally { setExecuting(false); }
  }

  async function cancelRun() {
    if (!window.confirm('Cancel this workflow run? Active local work will be interrupted and unfinished stages will not run.')) return;
    setCancelling(true);
    setAutoReconnect(false);
    setError('');
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Cancelled from the live run workspace.' }) });
      const result = await response.json() as { run?: WorkflowRun; errors?: string[]; error?: string };
      if (!response.ok || !result.run) throw new Error(result.errors?.join(' ') || result.error || 'The run could not be cancelled.');
      stopRequested.current = true;
      onRunUpdated?.(result.run);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The run could not be cancelled.'); }
    finally { setCancelling(false); }
  }

  useEffect(() => {
    if (initialContinuationChecked.current) return;
    initialContinuationChecked.current = true;
    // An already-running run was previously authorized. Reopening its page
    // should continue it, not require another click between ordinary stages.
    if (!serverOwned && status === 'running' && !inputRequired && !runtimeWaiting) continueAfterActiveNode.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (serverOwned || !continueAfterActiveNode.current || executing || active || runtimeWaiting || inputRequired || terminal || status === 'paused' || pending === 0) return;
    const timer = window.setTimeout(() => { continueAfterActiveNode.current = false; void runUntilGate(); }, 0);
    return () => window.clearTimeout(timer);
    // A long-running/replayed request may finish through the live event stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOwned, active, executing, runtimeWaiting, inputRequired, terminal, status, pending]);

  useEffect(() => {
    if (!retryAfterUntil) return;
    const timer = window.setTimeout(() => setRetryAfterUntil(0), Math.max(0, retryAfterUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAfterUntil]);

  useEffect(() => {
    if (serverOwned || !runtimeWaiting || !autoReconnect || executing || active || inputRequired || terminal || status === 'paused') return;
    const timer = window.setTimeout(() => { void runUntilGate(); }, 15_000);
    return () => window.clearTimeout(timer);
    // Recheck availability without consuming a node attempt; stop at human/input gates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOwned, runtimeWaiting, autoReconnect, executing, active, inputRequired, terminal, status]);

  useEffect(() => {
    if (serverOwned || autoStartKey <= consumedAutoStart.current || active || inputRequired || terminal || status === 'paused' || pending === 0 || retryAfterUntil > Date.now()) return;
    const timer = window.setTimeout(() => { consumedAutoStart.current = autoStartKey; void runUntilGate(); }, 0);
    return () => window.clearTimeout(timer);
    // autoStartKey is an explicit one-shot continuation signal from a resolved gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOwned, autoStartKey, inputRequired]);

  return <section className="execution-lock">
    <strong>{terminal ? 'Execution finished' : 'Workflow runner'}</strong>
    {runtimeWaiting && <p role="status">{serverOwned ? 'Waiting for your local runtime. Authorized work resumes server-side after reconnecting; you may close this page.' : 'Waiting for your local runtime. Automatic continuation requires this page to remain open.'}</p>}
    {!serverOwned && runtimeWaiting && autoReconnect && <button className="dash-button secondary" type="button" onClick={() => setAutoReconnect(false)}>Stop waiting automatically</button>}
    <p>{terminal ? 'This run has reached a terminal state.' : 'Runs approved stages within the concurrency budget and pauses at a decision, blocked action, failure, or completion.'}</p>
    {(error || latestError) && <p className="run-execution-error" role="alert">{error || latestError}</p>}
    {recheckable && <div><p>Correct the reported validation issues in the existing outputs, then recheck this step. Generated files and earlier approvals are preserved; validation must pass before execution continues.</p><button className="dash-button primary" type="button" disabled={executing || active || retryAfterUntil > 0} onClick={() => void retry(true)}>Recheck corrected outputs</button></div>}
    {retryable && status === 'failed' && <div><p>Continue from the failed step. Completed steps, saved inputs, and approvals are kept. The failed step runs again.</p><button className="dash-button primary" type="button" disabled={executing || active || retryAfterUntil > 0} onClick={() => void retry()}>{executing ? 'Retrying failed step…' : 'Retry failed step'}</button></div>}
    {interrupted && !executing && <button className="dash-button secondary" type="button" onClick={() => void recover()}>Recover interrupted node</button>}
    {executing && !serverOwned && <button className="dash-button secondary" type="button" disabled={stopping} onClick={() => { stopRequested.current = true; continueAfterActiveNode.current = false; setAutoReconnect(false); setStopping(true); }}>{stopping ? 'Stopping after this stage…' : 'Stop after current stage'}</button>}
    <button className="dash-button primary" type="button" disabled={disabled} onClick={() => void runUntilGate()}>{label}</button>
    {!terminal && <button className="dash-button danger" type="button" disabled={cancelling} onClick={() => void cancelRun()}>{cancelling ? 'Cancelling…' : 'Cancel workflow'}</button>}
  </section>;
}
