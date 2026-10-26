import { Client } from 'pg';
import { postgresConfig } from '@/scripts/postgres-config.cjs';

type Listener = () => void;
type Broker = { client?: Client; connecting?: Promise<void>; listeners: Map<string, Set<Listener>> };
const holder = globalThis as typeof globalThis & { __workflowStudioUserEventBroker?: Broker };
const broker: Broker = holder.__workflowStudioUserEventBroker ??= { listeners: new Map() } as Broker;

async function connect() {
  if (broker.client) return;
  if (broker.connecting) return broker.connecting;
  broker.connecting = (async () => {
    const client = new Client(postgresConfig());
    await client.connect();
    client.on('notification', (message) => {
      if (message.channel !== 'workflow_studio_user_events' || !message.payload) return;
      for (const listener of broker.listeners.get(message.payload) ?? []) listener();
    });
    client.on('error', () => {
      if (broker.client === client) broker.client = undefined;
      void client.end().catch(() => undefined);
      setTimeout(() => void connect().catch(() => undefined), 1_000);
    });
    await client.query('LISTEN workflow_studio_user_events');
    broker.client = client;
  })().finally(() => { broker.connecting = undefined; });
  return broker.connecting;
}

export async function subscribeUserEvent(key: string, listener: Listener) {
  await connect();
  const listeners = broker.listeners.get(key) ?? new Set<Listener>();
  listeners.add(listener);
  broker.listeners.set(key, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) broker.listeners.delete(key); };
}
