import { redactValue } from '@/src/server/redaction';
import { getDatabase } from './async-database';

export async function appendAuditEvent(input: {
  userId?: string;
  actor: { id: string; name: string; role: string };
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allowed' | 'denied' | 'approved' | 'rejected' | 'cancelled' | 'exported' | 'restored' | 'deleted';
  reason?: string;
  correlationId: string;
  details?: Record<string, unknown>;
}, now = new Date()) {
  await (await getDatabase()).run(`INSERT INTO audit_events (user_id, actor, action, resource_type, resource_id, decision, reason, policy_version, correlation_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [input.userId ?? null, JSON.stringify(redactValue(input.actor)), input.action.slice(0, 120), input.resourceType.slice(0, 80), input.resourceId.slice(0, 200), input.decision,
      input.reason?.slice(0, 2_000) ?? null, input.correlationId.slice(0, 200), JSON.stringify(redactValue(input.details ?? {})), now.toISOString()]);
}

export async function listAuditEvents(userId: string, limit = 200) {
  return await (await getDatabase()).all('SELECT action, resource_type AS resourceType, resource_id AS resourceId, decision, reason, policy_version AS policyVersion, correlation_id AS correlationId, created_at AS createdAt FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, Math.max(1, Math.min(1_000, limit))]);
}
