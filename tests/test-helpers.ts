import type { AssignmentApproval } from '@/src/domain/workspace';

export function testAssignmentApproval(workflowVersion = 1, configurationVersion = 1): AssignmentApproval {
  return {
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedBy: { id: 'test-approver', name: 'Test approver', role: 'reviewer' },
    workflowVersion,
    configurationVersion
  };
}
