import type { AuthUser, UserRole } from '@/src/auth/auth';

export type GovernedAction = 'approve-definition' | 'approve-assignment' | 'decide-workflow-gate' | 'promote-adaptation';

export function roleGatesEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.WORKFLOW_STUDIO_ENFORCE_ROLE_GATES === 'true';
}

export function canPerformGovernedAction(user: Pick<AuthUser, 'role'>, _action: GovernedAction, environment: Record<string, string | undefined> = process.env) {
  return !roleGatesEnabled(environment) || user.role === 'reviewer' || user.role === 'administrator';
}

export function validateManagedRole(value: unknown): value is UserRole {
  return value === 'builder' || value === 'reviewer' || value === 'administrator';
}
