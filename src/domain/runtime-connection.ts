export type RuntimeConnectionStatus = 'pairing' | 'online' | 'offline' | 'revoked';
export type RuntimeJobKind = 'planning' | 'focused-task' | 'workspace-inspection' | 'artifact-read' | 'skill-discovery';
export type RuntimeJobStatus = 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled';
export type RuntimeToolApprovalKind = 'command' | 'file-change' | 'permissions' | 'user-input' | 'other';
export type RuntimeToolApprovalStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type RuntimeToolApprovalDecision = 'accept' | 'decline' | 'cancel';
export const COMPANION_PROTOCOL_VERSION = 1;
export const COMPANION_APP_VERSION = '0.2.0';
export const COMPANION_MINIMUM_APP_VERSION = '0.1.0';

export function companionSupportsVerbosity(version?: string) {
  const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  return Boolean(parts && (parts[0] > 0 || parts[1] > 1 || parts[1] === 1 && parts[2] >= 1));
}

export function companionSupportsDurableResults(version?: string) {
  const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  return Boolean(parts && (parts[0] > 0 || parts[1] >= 2));
}

export interface RuntimeConnection {
  id: string;
  name: string;
  status: RuntimeConnectionStatus;
  authMode?: string;
  codexAccountLabel?: string;
  platform?: string;
  hostname?: string;
  allowedRoots: string[];
  createdAt: string;
  claimedAt?: string;
  lastSeenAt?: string;
  protocolVersion?: number;
  companionVersion?: string;
  supportedModels?: string[];
  supportedReasoningEfforts?: string[];
}

export interface RuntimePairing extends RuntimeConnection {
  pairingCode: string;
  pairingExpiresAt: string;
}

export interface RuntimeJob<TPayload = unknown, TResult = unknown> {
  id: string;
  userId: string;
  connectionId: string;
  kind: RuntimeJobKind;
  payload: TPayload;
  status: RuntimeJobStatus;
  leaseId?: string;
  leasedAt?: string;
  leaseExpiresAt?: string;
  result?: TResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RuntimeToolApproval {
  id: string;
  userId: string;
  connectionId: string;
  jobId: string;
  runId?: string;
  taskId?: string;
  nodeId?: string;
  requestMethod: string;
  kind: RuntimeToolApprovalKind;
  title: string;
  reason?: string;
  command?: string;
  cwd?: string;
  details: Record<string, unknown>;
  status: RuntimeToolApprovalStatus;
  decision?: RuntimeToolApprovalDecision;
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: { id: string; name: string; role: string };
  response?: Record<string, unknown>;
}

export interface PairedRuntimeTask {
  cwd: string;
  prompt: string;
  outputSchema: unknown;
  permission: 'read-only' | 'workspace';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  serviceName: string;
  metadata?: Record<string, string>;
  requireRuntimeApprovals?: boolean;
  allowedTools?: string[];
  modelSettings?: { model: string; reasoningEffort: string; verbosity?: 'low' | 'medium' | 'high' };
}

export type WorkspaceRuntimeTask =
  | { operation: 'inspect'; rootPath: string }
  | { operation: 'list'; rootPath: string }
  | { operation: 'create'; parentPath: string; folderName: string };

export const RUNTIME_ONLINE_WINDOW_MS = 45_000;
export const RUNTIME_PAIRING_DURATION_MS = 10 * 60_000;
export const RUNTIME_JOB_LEASE_MS = 60_000;
