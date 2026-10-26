import { describe, expect, it } from 'vitest';
import { buildPlanningPrompt } from '@/src/adapters/codex-cli-adapter';
import { attachMatchingSkills } from '@/src/domain/skill-matching';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS, validatePlanningRequest, type PlanningRequest } from '@/src/domain/planning';
import { validPlan } from './fixtures';

function request(): PlanningRequest {
  return {
    workflowName: 'UI screen generator',
    planningPrompt: 'Generate polished UI screens from requirements.',
    workspacePath: 'C:\\projects\\ui',
    constraints: [],
    outputRequirements: ['UI screen images'],
    executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
  };
}

describe('iterative planning and installed skill matching', () => {
  it('sends answers, the previous plan, and exact available skill ids into the revision pass', () => {
    const revision: PlanningRequest = {
      ...request(),
      previousPlan: validPlan(),
      previousPlanningThreadId: 'thread-1',
      questionResponses: [{ question: 'Which visual style?', answer: 'Dark editorial product UI.' }],
      availableSkills: [{ id: 'imagegen', name: 'imagegen', description: 'Generate or edit raster images.', source: 'installed-codex' }]
    };
    const prompt = buildPlanningPrompt(revision);
    expect(prompt).toContain('This is a revision pass');
    expect(prompt).toContain('Dark editorial product UI.');
    expect(prompt).toContain('imagegen');
    expect(validatePlanningRequest(revision)).toEqual({});
  });

  it('rejects blank answers submitted for re-planning', () => {
    const revision = { ...request(), previousPlan: validPlan(), questionResponses: [{ question: 'Which visual style?', answer: '' }] };
    expect(validatePlanningRequest(revision)).toHaveProperty('questionResponses');
  });

  it('requires the planner to verify reachable data flow before returning a graph', () => {
    const prompt = buildPlanningPrompt(request());
    expect(prompt).toContain('Every node input must be produced by an earlier reachable node');
    expect(prompt).toContain('Never require an output from a future or optional branch');
    expect(prompt).toContain('Give every output key one clear producer');
    expect(prompt).toContain('Never make a first-pass node require data that exists only after a loop');
    expect(prompt).toContain('both success and failure outcomes are reachable');
  });

  it('gives Codex explicit contract feedback during automatic graph repair', () => {
    const repair: PlanningRequest = {
      ...request(),
      previousPlan: validPlan(),
      previousPlanningThreadId: 'thread-1',
      graphRepairFeedback: ['Output key has multiple producers: report.']
    };
    const prompt = buildPlanningPrompt(repair);
    expect(prompt).toContain('automatic graph-contract repair pass');
    expect(prompt).toContain('Output key has multiple producers: report.');
    expect(prompt).toContain('Return a complete replacement plan');
  });

  it('attaches image generation skills only to nodes that require the capability', () => {
    const plan = validPlan();
    plan.nodes[0] = { ...plan.nodes[0], name: 'Generate UI screen images', prompt: 'Generate polished raster UI mockup images.', outputKeys: ['ui-screen-images'] };
    plan.nodes[1] = { ...plan.nodes[1], name: 'Validate requirements', prompt: 'Check requirement coverage.', skillIds: [] };
    const matched = attachMatchingSkills(plan, [
      { id: 'imagegen', name: 'imagegen', description: 'Generate or edit raster images and visual assets.', source: 'installed-codex' },
      { id: 'common-ui-screen-generator', name: 'common-ui-screen-generator', description: 'Generate consistent UI screen images and page mockups.', source: 'installed-codex' }
    ]);
    expect(matched.plan.nodes[0].skillIds).toEqual(expect.arrayContaining(['imagegen', 'common-ui-screen-generator']));
    expect(matched.plan.nodes[1].skillIds).not.toContain('imagegen');
  });

  it('removes an available but capability-incompatible skill proposed by the planner', () => {
    const plan = validPlan();
    plan.nodes[0] = {
      ...plan.nodes[0],
      name: 'Propose corrected requirements',
      prompt: 'Write evidence-backed requirement corrections and acceptance criteria.',
      skillIds: ['common-requirements-generator', 'preset'],
      inputKeys: ['requirementsInventory'],
      outputKeys: ['correctedRequirements']
    };
    const matched = attachMatchingSkills(plan, [
      { id: 'common-requirements-generator', name: 'Common requirements generator', description: 'Create and revise structured requirements and acceptance criteria.', source: 'installed-codex' },
      { id: 'preset', name: 'Preset', description: 'Deploy Azure OpenAI models to an optimal region based on model capacity.', source: 'installed-codex' }
    ]);
    expect(matched.plan.nodes[0].skillIds).toContain('common-requirements-generator');
    expect(matched.plan.nodes[0].skillIds).not.toContain('preset');
  });
});
