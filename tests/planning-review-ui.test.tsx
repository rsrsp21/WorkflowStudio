import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GraphReviewHandoff, PlanSummary, type ReviewDraft } from '@/src/components/workflow-workspace';
import { ReviewModal } from '@/src/components/workflow-dashboard';
import { validPlan } from './fixtures';

const draft: ReviewDraft = { plan: validPlan(), warnings: ['Report format is not specified.'], openQuestions: ['Which report format is preferred?'], planningThreadId: 'thread-1' };

describe('planning review UI', () => {
  it('displays warnings, ambiguity, original prompt, constraints, and identifiers', () => {
    const html = renderToStaticMarkup(React.createElement(PlanSummary, { draft, onQuestionsChange: () => undefined, onBack: () => undefined, onSave: () => undefined }));
    expect(html).toContain('Report format is not specified');
    expect(html).toContain('Which report format is preferred');
    expect(html).toContain('Original planning prompt');
    expect(html).toContain('Do not modify source files');
    expect(html).toContain('thread-1');
    expect(html).toContain('plan-1');
  });

  it('keeps compile disabled at the graph-review boundary', () => {
    const html = renderToStaticMarkup(React.createElement(GraphReviewHandoff, { draft, onRefine: () => undefined, onStartOver: () => undefined }));
    expect(html).toContain('Review graph');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve and compile<\/button>/);
    expect(html).toContain('Nothing has been compiled or executed');
  });

  it('offers an explicit unresolved path while keeping re-planning disabled', () => {
    const plan = validPlan();
    const html = renderToStaticMarkup(React.createElement(ReviewModal, {
      draft: { plan, warnings: [], openQuestions: plan.openQuestions, questionResponses: [{ question: plan.openQuestions[0], answer: '' }], planningThreadId: 'thread-1' },
      onClose: () => undefined,
      onReplan: () => undefined,
      onKeepCurrent: () => undefined,
      onContinueUnresolved: () => undefined,
      onAnswerChange: () => undefined
    }));
    expect(html).toContain('Continue with unresolved questions');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Re-plan with answers<\/button>/);
    expect(html).toContain('Proposed workflow');
    expect(html).toContain('Receives');
    expect(html).toContain('Produces');
    expect(html).toContain('Will be created');
    expect(html).not.toContain('document-review</small>');
  });

  it('offers regeneration or the original graph after all questions are answered', () => {
    const plan = validPlan();
    const html = renderToStaticMarkup(React.createElement(ReviewModal, {
      draft: { plan, warnings: [], openQuestions: plan.openQuestions, questionResponses: [{ question: plan.openQuestions[0], answer: 'Markdown.' }], planningThreadId: 'thread-1' },
      onClose: () => undefined,
      onReplan: () => undefined,
      onKeepCurrent: () => undefined,
      onContinueUnresolved: () => undefined,
      onAnswerChange: () => undefined
    }));
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Keep current plan<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Re-plan with answers<\/button>/);
  });
});
