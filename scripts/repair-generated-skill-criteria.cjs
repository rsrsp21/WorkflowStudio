// Repair only generated skills that exactly inherited a workflow's final criteria.
// Existing skill versions and frozen runs remain available for audit.
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
const { postgresConfig } = require('./postgres-config.cjs');

async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const runId = process.argv[2];
  if (!runId) throw new Error('Usage: node scripts/repair-generated-skill-criteria.cjs RUN_ID [--apply]');
  const { materializeWorkflowSkillDrafts } = await import('../src/domain/generated-skills.ts');
  const client = new Client(postgresConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    const runRow = (await client.query('SELECT user_id, payload FROM runs WHERE id = $1', [runId])).rows[0];
    if (!runRow) throw new Error('Run not found.');
    const run = JSON.parse(runRow.payload);
    const userId = runRow.user_id;
    const row = (await client.query('SELECT payload FROM workflows WHERE id = $1 AND user_id = $2 FOR UPDATE', [run.workflowId, userId])).rows[0];
    if (!row) throw new Error('Workflow not found.');
    const plan = JSON.parse(row.payload);
    const records = (await client.query('SELECT kind, id, payload FROM tenant_workspace_records WHERE user_id = $1 FOR UPDATE', [userId])).rows;
    const skills = records.filter((record) => record.kind === 'skills').map((record) => JSON.parse(record.payload));
    const drafts = materializeWorkflowSkillDrafts(plan, []).drafts;
    const replacements = new Map();
    const now = new Date().toISOString();
    for (const draft of drafts) {
      const old = skills.find((skill) => skill.id === draft.id);
      if (!old || old.scope?.workflowId !== plan.id || old.source !== `Generated from ${plan.name}`) continue;
      if (!plan.completionCriteria.length || JSON.stringify(old.validationCriteria) !== JSON.stringify(plan.completionCriteria)) continue;
      const familyId = old.familyId || old.id;
      const version = Math.max(...skills.filter((skill) => (skill.familyId || skill.id) === familyId).map((skill) => skill.version)) + 1;
      const skill = { ...old, id: `${familyId}-v${version}-${randomUUID().slice(0, 8)}`, familyId, version, validationCriteria: draft.validationCriteria, createdAt: now, updatedAt: now };
      replacements.set(old.id, skill);
    }
    if (!replacements.size) {
      console.log('No affected generated skills remain referenced by this workflow.');
      await client.query('ROLLBACK');
      return;
    }
    const replaceRefs = (refs) => refs.map((ref) => {
      const skill = replacements.get(ref.skillId);
      return skill ? { ...ref, skillId: skill.id, version: skill.version } : ref;
    });
    const replaceGraph = (graph) => {
      graph.nodes = graph.nodes.map((node) => ({ ...node, skillIds: node.skillIds.map((id) => replacements.get(id)?.id || id) }));
      graph.status = 'draft';
      graph.updatedAt = now;
      delete graph.definitionApproval;
      return graph;
    };
    const nextPlan = replaceGraph(structuredClone(plan));
    nextPlan.version = (plan.version || 1) + 1;
    const updates = [];
    for (const record of records) {
      const value = JSON.parse(record.payload);
      if (record.kind === 'workflow-definitions' && value.id === plan.id) {
        value.defaultSkillVersions = replaceRefs(value.defaultSkillVersions);
        value.version = nextPlan.version;
        value.status = 'draft';
      } else if (record.kind === 'project-workflows' && value.workflowId === plan.id) {
        value.selectedSkills = replaceRefs(value.selectedSkills);
        if (value.graphOverride) value.graphOverride = replaceGraph(value.graphOverride);
        value.workflowVersion = nextPlan.version;
        if (value.graphOverride) value.graphOverride.version = nextPlan.version;
        value.configurationVersion = (value.configurationVersion || 1) + 1;
        if (value.status !== 'archived') value.status = 'draft';
        delete value.approval;
      } else continue;
      value.updatedAt = now;
      updates.push({ ...record, value });
    }
    console.log(JSON.stringify({ workflowId: plan.id, workflowVersion: nextPlan.version, skills: [...replacements.values()].map((skill) => ({ id: skill.id, version: skill.version })), assignments: updates.filter((record) => record.kind === 'project-workflows').map((record) => record.id), approvalRequired: true, apply: process.argv.includes('--apply') }, null, 2));
    if (!process.argv.includes('--apply')) { await client.query('ROLLBACK'); return; }
    for (const skill of replacements.values()) await client.query('INSERT INTO tenant_workspace_records (user_id, kind, id, payload) VALUES ($1, $2, $3, $4)', [userId, 'skills', skill.id, JSON.stringify(skill)]);
    await client.query('UPDATE workflows SET payload = $1, status = $2, updated_at = $3 WHERE user_id = $4 AND id = $5', [JSON.stringify(nextPlan), 'draft', now, userId, plan.id]);
    for (const record of updates) await client.query('UPDATE tenant_workspace_records SET payload = $1 WHERE user_id = $2 AND kind = $3 AND id = $4', [JSON.stringify(record.value), userId, record.kind, record.id]);
    await client.query('INSERT INTO audit_events (user_id, actor, action, resource_type, resource_id, decision, reason, policy_version, correlation_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10)', [userId, JSON.stringify({ id: 'generated-skill-repair', name: 'Generated skill criteria repair', role: 'system' }), 'skill.repair-stage-criteria', 'workflow', plan.id, 'allowed', 'User requested correction of inherited workflow completion criteria. Definition and assignment approvals invalidated.', runId, JSON.stringify({ replacements: [...replacements].map(([oldId, skill]) => ({ oldId, newId: skill.id, version: skill.version })), workflowVersion: nextPlan.version }), now]);
    await client.query('COMMIT');
    console.log('Repair committed. Review and approve the revised workflow and assignment before compiling a new run.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}

main().catch((error) => { console.error(`Repair failed (${error.code || error.name}).`); process.exitCode = 1; });
