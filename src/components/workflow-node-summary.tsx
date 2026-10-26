import type { WorkflowNode } from '@/src/domain/models';
import type { Skill } from '@/src/domain/workspace';
import UiIcon from './ui-icon';
import { WorkflowNodeIcon, workflowNodeTypeLabel } from './workflow-node-visual';

const SKILL_BACKED_NODE_TYPES = new Set(['agent', 'codex', 'tool', 'validation']);

export function humanizeWorkflowLabel(value: string): string {
  const label = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[-_./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'Unnamed item';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function proposedSkillName(node: WorkflowNode, skillId: string): string {
  return slug(skillId).includes(slug(node.name)) ? `${node.name} skill` : humanizeWorkflowLabel(skillId);
}

function SummaryChips({ values, emptyText, limit }: { values: string[]; emptyText: string; limit: number }) {
  const shown = values.slice(0, limit);
  const remaining = values.length - shown.length;
  return <div className="node-summary-chips">
    {shown.length ? shown.map((value) => <span className="node-summary-chip" key={value}>{humanizeWorkflowLabel(value)}</span>) : <span className="node-summary-empty">{emptyText}</span>}
    {remaining > 0 && <span className="node-summary-more">+{remaining} more</span>}
  </div>;
}

export default function WorkflowNodeSummary({ node, index, skills = [], variant = 'review' }: {
  node: WorkflowNode;
  index: number;
  skills?: Skill[];
  variant?: 'review' | 'step';
}) {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const attachedSkills = node.skillIds.map((id) => {
    const skill = skillById.get(id);
    return { id, name: skill?.name ?? proposedSkillName(node, id), state: skill?.status ?? 'suggested' };
  });
  const createsSkill = attachedSkills.length === 0 && SKILL_BACKED_NODE_TYPES.has(node.type);
  const chipLimit = variant === 'step' ? 5 : 3;

  return <article className={`workflow-node-summary ${variant} type-${node.type}`} aria-label={`Step ${index + 1}: ${node.name}, ${workflowNodeTypeLabel(node.type)}`}>
    <header className="node-summary-header">
      <span className="node-summary-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className={`step-node-icon type-${node.type}`}><WorkflowNodeIcon type={node.type} /></span>
      <span className="node-summary-title">
        <strong>{node.name}</strong>
        <span className="node-summary-type">{workflowNodeTypeLabel(node.type)}</span>
      </span>
    </header>

    {variant === 'step' && <div className="node-summary-purpose">
      <span>Purpose</span>
      <p title={node.prompt}>{node.prompt || 'Instructions have not been added yet.'}</p>
    </div>}

    <div className="node-summary-flow">
      <section>
        <h4><UiIcon name="input" />Receives</h4>
        <SummaryChips values={node.inputKeys} emptyText="Starts here" limit={chipLimit} />
      </section>
      <span className="node-summary-flow-arrow" aria-hidden="true"><UiIcon name="arrow-right" /></span>
      <section>
        <h4><UiIcon name="output" />Produces</h4>
        <SummaryChips values={node.outputKeys} emptyText="No declared output" limit={chipLimit} />
      </section>
    </div>

    <div className="node-summary-skills">
      <h4><UiIcon name="skill" />Skills</h4>
      <div className="node-summary-skill-list">
        {attachedSkills.map((skill) => <span className={`node-summary-skill state-${skill.state}`} key={skill.id} title={skill.name}>
          <span>{skill.name}</span>
          <small>{skill.state === 'published' ? 'Ready' : skill.state === 'draft' ? 'Needs review' : skill.state === 'archived' ? 'Archived' : 'Suggested'}</small>
        </span>)}
        {createsSkill && <span className="node-summary-skill state-planned"><span>{node.name} skill</span><small>Will be created</small></span>}
        {!attachedSkills.length && !createsSkill && <span className="node-summary-empty">No skill needed for this control step</span>}
      </div>
    </div>

    {node.type === 'approval' && Boolean(node.approvalOptions?.length) && <div className="node-summary-outcomes">
      <h4>Decision buttons</h4>
      <div>{node.approvalOptions?.map((option) => <span className={`approval-option-chip action-${option.action}`} key={option.id}><strong>{option.label}</strong><small>{option.keyword} · {option.action}</small></span>)}</div>
    </div>}
  </article>;
}
