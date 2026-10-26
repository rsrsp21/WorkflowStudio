import { describe, expect, it } from 'vitest';
import { validateWorkflowPlan, validateWorkflowQuestionsResolved } from '@/src/domain/models';
import { validPlan } from './fixtures';

describe('WorkflowPlan validation', () => {
  it('accepts a complete valid plan', () => expect(validateWorkflowPlan(validPlan())).toEqual([]));

  it('rejects missing required fields and invalid graph references', () => {
    const plan = validPlan();
    plan.name = '';
    plan.nodes[1].id = plan.nodes[0].id;
    plan.edges[0].to = 'missing-node';
    const errors = validateWorkflowPlan(plan).join(' ');
    expect(errors).toContain('Workflow name is required');
    expect(errors).toContain('duplicated');
    expect(errors).toContain('unknown target node');
  });

  it('rejects invalid harness and status values', () => {
    const plan = validPlan();
    plan.harness.maxConcurrentNodes = 0;
    plan.status = 'executing' as never;
    const errors = validateWorkflowPlan(plan).join(' ');
    expect(errors).toContain('Maximum concurrency');
    expect(errors).toContain('Unsupported workflow status');
  });

  it('preserves explicit answers to planning questions', () => {
    const plan = validPlan();
    plan.questionResponses = [{ question: 'Which report format?', answer: 'Markdown.' }];
    expect(validateWorkflowPlan(plan)).toEqual([]);
    plan.questionResponses = [{ question: '', answer: 'Markdown.' }];
    expect(validateWorkflowPlan(plan).join(' ')).toContain('Question responses');
  });

  it('requires every planning question to be answered before saving', () => {
    const plan = validPlan();
    expect(validateWorkflowQuestionsResolved(plan).join(' ')).toContain('Answer every open question');

    plan.openQuestions = [];
    plan.questionResponses = [{ question: 'Which report format is preferred?', answer: '' }];
    expect(validateWorkflowQuestionsResolved(plan).join(' ')).toContain('non-empty answer');

    plan.questionResponses[0].answer = 'Markdown.';
    expect(validateWorkflowQuestionsResolved(plan)).toEqual([]);
  });
});
