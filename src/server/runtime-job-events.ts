import { Client } from 'pg';
import { postgresConfig } from '@/scripts/postgres-config.cjs';

export type RuntimeServerEvent = { type: 'job' | 'job-cancelled' | 'approval-decided'; jobId?: string; approvalId?: string };
type Listener = (event: RuntimeServerEvent) => void;
type JobUpdateListener = () => void;
type Broker = {
  client?: Client;
  connecting?: Promise<void>;
  listeners: Map<string, Set<Listener>>;
  jobUpdateListeners: Map<string, Set<JobUpdateListener>>;
};

const holder = globalThis as typeof globalThis & { __workflowStudioRuntimeJobBroker?: Broker };
const broker: Broker = holder.__workflowStudioRuntimeJobBroker ??= { listeners: new Map(), jobUpdateListeners: new Map() } as Broker;
broker.jobUpdateListeners ??= new Map();

async function connect() {
  if (broker.client) return;
  if (broker.connecting) return broker.connecting;
  broker.connecting = (async () => {
    const client = new Client(postgresConfig());
    await client.connect();
    client.on('notification', (message) => {
      if (!message.payload) return;
      if (message.channel === 'workflow_studio_runtime_jobs') {
        for (const listener of broker.listeners.get(message.payload) ?? []) listener({ type: 'job' });
        return;
      }
      if (message.channel === 'workflow_studio_runtime_events') {
        try {
          const event = JSON.parse(message.payload) as RuntimeServerEvent & { connectionId: string };
          for (const listener of broker.listeners.get(event.connectionId) ?? []) listener(event);
        } catch { /* Ignore malformed database notifications. */ }
      }
      if (message.channel === 'workflow_studio_runtime_job_updates') {
        for (const listener of broker.jobUpdateListeners.get(message.payload) ?? []) listener();
      }
    });
    client.on('error', () => {
      if (broker.client === client) broker.client = undefined;
      void client.end().catch(() => undefined);
      setTimeout(() => void connect().catch(() => undefined), 1_000);
    });
    await client.query('LISTEN workflow_studio_runtime_jobs');
    await client.query('LISTEN workflow_studio_runtime_events');
    await client.query('LISTEN workflow_studio_runtime_job_updates');
    broker.client = client;
  })().finally(() => { broker.connecting = undefined; });
  return broker.connecting;
}

export async function subscribeRuntimeJobUpdates(jobId: string, listener: JobUpdateListener) {
  await connect();
  const listeners = broker.jobUpdateListeners.get(jobId) ?? new Set<JobUpdateListener>();
  listeners.add(listener);
  broker.jobUpdateListeners.set(jobId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) broker.jobUpdateListeners.delete(jobId);
  };
}

export async function subscribeRuntimeJobs(connectionId: string, listener: Listener) {
  await connect();
  const listeners = broker.listeners.get(connectionId) ?? new Set<Listener>();
  listeners.add(listener);
  broker.listeners.set(connectionId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) broker.listeners.delete(connectionId);
  };
}
