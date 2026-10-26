import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectWorkspaceSelector, WorkflowHistory } from '@/src/components/workflow-workspace';
import WorkflowDashboard, { composePlanningPrompt } from '@/src/components/workflow-dashboard';
import { createProject, type ProjectFolderInspection } from '@/src/domain/workspace';
import { validPlan } from './fixtures';

const noop = () => undefined;
const project = createProject({ id: 'project-docs', name: 'Policy documents', rootPath: 'C:\\projects\\policy-docs', workspaceKind: 'workspace' });
const inspection: ProjectFolderInspection = {
  rootPath: project.rootPath,
  workspaceKind: 'workspace',
  entryCount: 4,
  directoryCount: 2,
  fileCount: 2,
  hasGitMetadata: false,
  inspectionMode: 'read-only',
  inspectedAt: '2026-08-27T00:00:00.000Z'
};

function renderSelector(selected = false) {
  return renderToStaticMarkup(<ProjectWorkspaceSelector projects={[project]} selectedProject={selected ? project : null} pathValue={project.rootPath} projectName={project.name} inspection={inspection} listing={null} busy={false} error="" nativePickerAvailable={false} onPathChange={noop} onNameChange={noop} onAutofill={noop} onInspect={noop} onNativeSelect={noop} onBrowse={noop} onCreateFolder={noop} onConfirm={noop} onSelectSaved={noop} />);
}

describe('project workspace selection UI', () => {
  it('shows inspection type, read-only access, and explicit confirmation', () => {
    const html = renderSelector();
    expect(html).toContain('Autofill fields');
    expect(html).toContain('Existing workspace');
    expect(html).toContain('Read-only');
    expect(html).toContain('Confirm project root');
  });

  it('shows the exact confirmed root and scope state', () => {
    const html = renderSelector(true);
    expect(html).toContain('Confirmed access scope');
    expect(html).toContain('C:\\projects\\policy-docs');
  });
});

describe('application screen layout', () => {
  it('uses one dashboard without a left navigation sidebar', () => {
    const html = renderToStaticMarkup(<WorkflowDashboard />);
    expect(html).not.toContain('class="sidebar"');
    expect(html).not.toContain('aria-label="Application screens"');
    expect(html).toContain('workflow-studio-logo.png');
    expect(html).toContain('Build reliable agent workflows');
    expect(html).toContain('Create workflow');
    expect(html).not.toContain('Create a reusable workflow');
    expect(html).toContain('Your workflows');
    expect(html).not.toContain('Harness defaults');
    expect(html).toContain('Runs and monitoring');
    expect(html).not.toContain('Monitoring logs');
  });

  it('does not ask for a project root during reusable workflow creation', () => {
    const html = renderToStaticMarkup(<WorkflowDashboard />);
    expect(html).toContain('A project is chosen later, when you use it');
    expect(html).not.toContain('Project context is attached later through “Use workflow.”');
    expect(html).not.toContain('Choose a project first.');
    expect(html).not.toContain('id="dash-project-root"');
    expect(html).not.toContain('Generate workflow');
  });
});

describe('structured workflow creation', () => {
  it('turns focused fields into a sectioned planning prompt', () => {
    const prompt = composePlanningPrompt({ objective: 'Review requirements.', stages: 'Inspect inputs\nReport gaps', decisions: 'Is context sufficient?', approvals: 'Approve final report' });
    expect(prompt).toContain('Objective:\nReview requirements.');
    expect(prompt).toContain('Stages:\n- Inspect inputs\n- Report gaps');
    expect(prompt).toContain('Decision points:\n- Is context sufficient?');
    expect(prompt).toContain('Human approval points:\n- Approve final report');
  });
});

describe('workflow history deletion UI', () => {
  it('offers deletion without showing a destructive confirmation initially', () => {
    const html = renderToStaticMarkup(<WorkflowHistory workflows={[validPlan()]} pendingDeleteId={null} deleting={false} onRequestDelete={noop} onCancelDelete={noop} onConfirmDelete={noop} />);
    expect(html).toContain('Delete Document review');
    expect(html).not.toContain('This cannot be undone');
  });

  it('requires an explicit second confirmation', () => {
    const html = renderToStaticMarkup(<WorkflowHistory workflows={[validPlan()]} pendingDeleteId="plan-1" deleting={false} onRequestDelete={noop} onCancelDelete={noop} onConfirmDelete={noop} />);
    expect(html).toContain('This cannot be undone');
    expect(html).toContain('Cancel');
    expect(html).toContain('>Delete</button>');
  });
});
