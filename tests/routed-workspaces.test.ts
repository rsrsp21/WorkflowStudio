import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('routed graph and skill workspaces', () => {
  it('defines dedicated graph, registry, create, and edit pages', async () => {
    const [graphRoute, skillsRoute, newSkillRoute, editSkillRoute] = await Promise.all([
      source('src/app/workflows/[workflowId]/graph/page.tsx'),
      source('src/app/skills/page.tsx'),
      source('src/app/skills/new/page.tsx'),
      source('src/app/skills/[skillId]/edit/page.tsx')
    ]);

    expect(graphRoute).toContain('WorkflowGraphPage');
    expect(skillsRoute).toContain('SkillsPage');
    expect(newSkillRoute).toContain('SkillEditorPage');
    expect(editSkillRoute).toContain('skillId');
  });

  it('navigates from the dashboard instead of rendering embedded graph or skill editors', async () => {
    const dashboard = await source('src/components/workflow-dashboard.tsx');

    expect(dashboard).toContain('href={`/workflows/${encodeURIComponent(workflow.id)}/graph`}');
    expect(dashboard).toContain('href="/skills"');
    expect(dashboard).not.toContain('href="/skills/new"');
    expect(dashboard).not.toContain('activeWorkflow ? <GraphEditor');
    expect(dashboard).not.toContain('{skillForm && <SkillModal');
  });

  it('grants workspace access only for a specific project assignment', async () => {
    const [dashboard, graph, legacyCreator, assignment] = await Promise.all([
      source('src/components/workflow-dashboard.tsx'),
      source('src/components/phase3-graph-editor.tsx'),
      source('src/components/workflow-workspace.tsx'),
      source('src/components/assignment-modal.tsx')
    ]);

    expect(dashboard).not.toContain('id="create-sandbox"');
    expect(dashboard).not.toContain('id="graph-sandbox"');
    expect(graph).not.toContain('id="graph-sandbox"');
    expect(legacyCreator).not.toContain('id="sandbox-mode"');
    expect(assignment).toContain('id="assignment-sandbox"');
    expect(assignment).toContain('I confirm this assignment may write inside the selected project root.');
  });

  it('offers workflow-scoped review and bulk skill enabling without visiting the skill directory', async () => {
    const graph = await source('src/components/workflow-graph-page.tsx');
    expect(graph).toContain('Review and enable all');
    expect(graph).toContain('workflow.nodes.flatMap((node) => node.skillIds)');
    expect(graph).toContain("action: 'publish'");
    expect(graph).toContain('selectedSkillIds');
    expect(graph).toContain('expectedConfigurationVersion');
  });

  it('routes app back actions and logos to the studio instead of the landing page', async () => {
    const [shell, dashboard, graph, skills, landing] = await Promise.all([
      source('src/components/studio-page-shell.tsx'),
      source('src/components/workflow-dashboard.tsx'),
      source('src/components/workflow-graph-page.tsx'),
      source('src/components/skills-page.tsx'),
      source('src/app/page.tsx')
    ]);

    expect(shell).toContain('className="dash-brand" href="/studio"');
    expect(dashboard).toContain('className="dash-brand" href="/studio"');
    expect(graph).toContain("onBack={() => router.push('/studio')}");
    expect(skills).toContain('<BackButton href="/studio">Studio</BackButton>');
    expect(landing.match(/className=\{styles\.brand\} href=\{user \? '\/studio' : '\/'\}/g)).toHaveLength(2);
  });

  it('uses one strong icon standard and gives authentication inputs examples', async () => {
    const [globals, dashboard, landing, authForm] = await Promise.all([
      source('src/app/globals.css'),
      source('src/app/dashboard.css'),
      source('src/app/landing.module.css'),
      source('src/components/auth-form.tsx')
    ]);

    expect(globals).toContain('--icon-size:22px; --icon-stroke:2.3;');
    expect(dashboard).toContain('width:var(--icon-size); height:var(--icon-size)');
    expect(landing).toContain('.page svg { width:22px; height:22px;');
    expect(landing).not.toMatch(/(?:navCta|promiseRow|stageRail|nodeIcon|howCopy)[^}]*svg[^}]*width:(?:12|14|15|18)px/);
    expect(authForm).toContain('placeholder="e.g. Alex Morgan"');
    expect(authForm).toContain('placeholder="e.g. Software Developer"');
    expect(authForm).toContain('placeholder="you@company.com"');
    expect(authForm).toContain("placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'}");
  });
});
