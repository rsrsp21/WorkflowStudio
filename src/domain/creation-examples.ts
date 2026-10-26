export interface WorkflowCreationExample {
  id: string;
  label: string;
  name: string;
  objective: string;
  stages: string;
  decisions: string;
  approvals: string;
  constraints: string;
  outputs: string;
}

export interface SkillCreationExample {
  id: string;
  label: string;
  name: string;
  description: string;
  instructions: string;
  triggers: string;
  requiredContext: string;
  inputs: string;
  outputs: string;
  requiredPermissions: string;
  validationCriteria: string;
  source: string;
  author: string;
  compatibility: string;
  estimatedContextTokens: number;
}

const WORKFLOW_EXAMPLES: WorkflowCreationExample[] = [
  {
    id: 'product-planning-delivery',
    label: 'Product planning and UI delivery',
    name: 'Product planning and UI delivery',
    objective: 'Turn a rough product idea into approved requirements, design direction, architecture, UI examples, and an implementation phase plan using focused specialist skills.',
    stages: 'Clarify the product idea and authoritative project context\nGenerate requirements and PRD with common-requirements-generator\nReview and revise requirements until accepted\nCreate product design guidance with common-design-generator\nReview and revise the design direction until accepted\nChoose or recommend the technology stack\nCreate frontend architecture with common-frontend-architecture-generator\nCreate backend architecture with common-backend-architecture-generator\nGenerate architecture diagrams with common-architecture-diagram-generator\nGenerate UI screen examples with common-ui-screen-generator and imagegen\nReview and regenerate inconsistent screens when requested\nCreate implementation phases, tasks, dependencies, and verification gates\nPackage the approved planning artifacts for handoff',
    decisions: 'Is enough authoritative context available to begin?\nDo the requirements accurately express the intended product?\nDoes the design direction satisfy the approved requirements?\nShould the user provide a stack, request a recommendation, or compare options?\nAre the architecture artifacts implementable and internally consistent?\nAre the UI examples ready, or should selected screens be regenerated?\nIs the phased delivery plan ready for implementation?',
    approvals: 'Requirements gate: custom keywords CONTINUE TO DESIGN, REVISE REQUIREMENTS, or STOP\nDesign gate: custom keywords CONTINUE TO ARCHITECTURE, REVISE DESIGN, or STOP\nTech stack gate: custom keywords PROVIDE STACK, RECOMMEND STACK, COMPARE OPTIONS, or STOP\nArchitecture gate: custom keywords CONTINUE TO UI, REVISE ARCHITECTURE, or STOP\nUI output mode gate: custom keywords DESKTOP, MOBILE, BOTH, or STOP\nUI gate: custom keywords BUILD PHASES, REGENERATE SCREENS, or STOP\nFinal handoff gate: custom keywords APPROVE PLAN, REVISE PHASES, or STOP\nEvery revision outcome must route through a bounded loop to the focused specialist that owns that artifact; stack and viewport choices are explicit approval outcomes, never freeform answers',
    constraints: 'Keep the workflow generic and editable rather than hard-coding a product type\nUse exact installed skill ids when available\nRun each skill-backed stage as a visible focused specialist task\nNever silently advance past a human gate\nPreserve approved artifacts while revising only the rejected stage\nKeep file access inside the approved project root\nRequire explicit approval for command, file, network, or other governed side effects\nRecord every decision, revision, artifact, and route in the run history',
    outputs: 'requirements.md or PRD document\ndesign.md\nfrontend-architecture.md\nbackend-architecture.md\narchitecture diagram sources and images\nUI screen example images and screen inventory\nimplementation phases and task plan\napproval and revision audit trail\nfinal project-planning handoff'
  },
  {
    id: 'requirements-quality-review',
    label: 'Requirements quality review',
    name: 'Requirements quality review',
    objective: 'Review requirements and prepare an evidence-based, approval-ready quality assessment.',
    stages: 'Inspect requirements and supporting context\nIdentify ambiguity and missing acceptance criteria\nPropose corrections\nValidate testability and traceability\nPrepare the final review package',
    decisions: 'Is enough context available to make a finding?\nIs each requirement testable and traceable?\nAre blocking gaps resolved?',
    approvals: 'Human approves the proposed corrections and final review summary; applying changes to source requirements is a separate explicitly authorized task',
    constraints: 'Do not modify source material\nCite evidence for every finding\nAsk questions instead of inventing context',
    outputs: 'Requirements review report\nTraceability matrix\nOpen questions\nApproval-ready summary'
  },
  {
    id: 'ui-screen-generation',
    label: 'UI screen generation',
    name: 'UI screen generation',
    objective: 'Turn approved requirements and design guidance into a consistent set of reviewable UI screen concepts.',
    stages: 'Inspect requirements and design guidance\nMap the screen flow and shared components\nPrepare generation prompts\nGenerate the screen set and save images in the selected project\nReview visual and interaction consistency once and report material findings\nLet the user inspect the screens and report, then continue, revise selected screens, or stop\nPackage the user-accepted screens for review',
    decisions: 'Are requirements and design guidance complete?\nDoes each screen cover an approved user task?\nDoes the user accept the screens with the reported tradeoffs, request a targeted revision, or stop?',
    approvals: 'Human approves the visual direction before generating the complete screen set\nAfter every consistency review, show the actual screens and findings with CONTINUE WITH SCREENS, REVISE SELECTED SCREENS, and STOP options\nOnly REVISE SELECTED SCREENS enters the bounded regeneration loop; ask which screens and changes the user wants\nHuman approves the final screen package',
    constraints: 'Use approved brand tokens and layout rules\nDo not invent unsupported product capabilities\nCheck material differences in shared components, not pixel-perfect identity or minor cosmetic variation\nConsistency findings are advisory: never automatically regenerate screens or fail the run for subjective visual differences\nAlways allow the user to continue with existing valid screens, including when the revision budget is exhausted\nPreserve accepted screens and regenerate only the user-selected screens',
    outputs: 'Screen inventory\nGenerated UI screen images\nScreen-flow map\nVisual consistency report'
  },
  {
    id: 'pull-request-review',
    label: 'Pull request review',
    name: 'Pull request review',
    objective: 'Review a proposed code change for correctness, regressions, maintainability, and test coverage.',
    stages: 'Inspect the change and repository guidance\nTrace affected behavior\nReview implementation risks\nEvaluate tests and validation evidence\nPrepare prioritized findings',
    decisions: 'Does the change match its stated intent?\nAre any findings release-blocking?\nIs additional test evidence required?',
    approvals: 'Human reviewer decides whether the change is ready to merge',
    constraints: 'Do not modify the branch during review\nPrioritize actionable findings over summaries\nReference exact files and evidence',
    outputs: 'Prioritized review findings\nRegression risk summary\nTest coverage gaps\nMerge recommendation'
  },
  {
    id: 'release-readiness',
    label: 'Release readiness assessment',
    name: 'Release readiness assessment',
    objective: 'Assess whether a release candidate satisfies quality, operational, security, and approval gates.',
    stages: 'Collect release scope and evidence\nCheck test and quality gates\nReview operational readiness\nReview security and compliance status\nDocument release blockers, proposed remediation, and evidence of any completed fixes\nPrepare the go-live recommendation package without deploying',
    decisions: 'Did every required gate pass?\nAre unresolved risks acceptable?\nIs rollback readiness sufficient?',
    approvals: 'Release owner approves the go-live recommendation',
    constraints: 'Treat missing evidence as unresolved\nKeep waivers explicit and attributable\nDo not mark a gate complete without evidence',
    outputs: 'Release readiness report\nGate checklist\nRisk and waiver register\nGo or no-go recommendation'
  },
  {
    id: 'incident-investigation',
    label: 'Incident investigation',
    name: 'Incident investigation',
    objective: 'Build an evidence-backed incident timeline, identify contributing causes, and propose corrective actions.',
    stages: 'Collect incident evidence\nBuild the event timeline\nTest causal hypotheses\nIdentify root and contributing causes\nDefine corrective actions\nPrepare the incident review',
    decisions: 'Is the evidence sufficient to support a cause?\nDoes a hypothesis explain the observed impact?\nDo corrective actions address the verified causes?',
    approvals: 'Incident commander approves the final review and action owners',
    constraints: 'Separate facts from hypotheses\nPreserve source timestamps\nDo not assign blame or invent missing events',
    outputs: 'Incident timeline\nRoot-cause analysis\nCorrective action register\nIncident review summary'
  },
  {
    id: 'security-threat-review',
    label: 'Security threat review',
    name: 'Security threat review',
    objective: 'Identify credible threats in a proposed system design and produce prioritized, verifiable mitigations.',
    stages: 'Inspect architecture and trust boundaries\nInventory assets and entry points\nModel credible threats\nEvaluate existing controls\nPrioritize mitigations\nPrepare the security review',
    decisions: 'Is each trust boundary documented?\nIs residual risk acceptable?\nDoes a mitigation have a verification method?',
    approvals: 'Security owner accepts or rejects residual risks',
    constraints: 'Use only supported architecture evidence\nRecord assumptions as open questions\nDo not expose secrets in the report',
    outputs: 'Threat model\nPrioritized risk register\nMitigation plan\nResidual-risk approval record'
  },
  {
    id: 'data-migration-validation',
    label: 'Data migration validation',
    name: 'Data migration validation',
    objective: 'Validate migration mappings, reconciliation evidence, exception handling, and rollback readiness.',
    stages: 'Inspect source and target contracts\nValidate field mappings and transformations\nReview migration controls\nReconcile sample and aggregate results\nDocument material exceptions and recommended remediation without modifying migration data\nPrepare the migration decision package without executing migration or rollback',
    decisions: 'Are mappings complete and deterministic?\nDo reconciliation totals meet tolerance?\nIs rollback required for unresolved exceptions?',
    approvals: 'Data owner approves migration acceptance and unresolved exceptions',
    constraints: 'Do not alter production data\nMask sensitive values in evidence\nUse explicit reconciliation tolerances',
    outputs: 'Mapping validation report\nReconciliation results\nException register\nMigration acceptance recommendation'
  },
  {
    id: 'architecture-decision-review',
    label: 'Architecture decision review',
    name: 'Architecture decision review',
    objective: 'Evaluate an architecture proposal against requirements, constraints, alternatives, and operational consequences.',
    stages: 'Inspect the proposal and decision drivers\nValidate assumptions and constraints\nCompare viable alternatives\nAssess quality attributes and tradeoffs\nPresent blocking concerns and proposed resolutions for an explicit human decision\nPrepare the decision record without implementing architecture changes',
    decisions: 'Does the proposal satisfy required quality attributes?\nWas a viable alternative omitted?\nAre operational tradeoffs acceptable?',
    approvals: 'Architecture owner approves the decision record and accepted tradeoffs',
    constraints: 'Keep facts, assumptions, and preferences separate\nUse measurable quality attributes\nRecord rejected alternatives and rationale',
    outputs: 'Architecture assessment\nAlternative comparison\nRisk and tradeoff register\nApproval-ready decision record'
  }
];

/** Shared defaults keep every editable example explicit about review and delivery. */
export const WORKFLOW_CREATION_EXAMPLES: WorkflowCreationExample[] = WORKFLOW_EXAMPLES.map((example) => ({
  ...example,
  approvals: `${example.approvals}\nFor discretionary quality revisions, show findings and artifacts to the user before any bounded revision loop. Offer continue with recorded tradeoffs, revise selected items, or stop; never automatically repeat a quality check until it passes. At the revision limit, keep continue and stop available and explain that further revisions require an explicitly increased limit.`,
  constraints: `${example.constraints}\nUse the selected project folder for every step. Save created deliverables and edit requested files there; report real artifact paths and preserve unrelated files. Reviewing source material does not authorize changing it.\nReview quality against the approved scope once per attempt; do not invent stricter criteria or repeat unchanged checks. Human acceptance may record discretionary tradeoffs, but cannot bypass missing files, invalid output contracts, permissions, security, or mandatory compliance controls.`
}));

const SKILL_DEFAULTS = {
  source: 'Built-in example',
  author: 'Workflow Studio',
  compatibility: 'Codex App Server'
};

export const SKILL_CREATION_EXAMPLES: SkillCreationExample[] = [
  {
    ...SKILL_DEFAULTS,
    id: 'requirements-evidence-reviewer',
    label: 'Requirements evidence reviewer',
    name: 'Requirements evidence reviewer',
    description: 'Reviews requirements for clarity, completeness, testability, and evidence-backed traceability.',
    instructions: 'Inspect every in-scope requirement and its supporting source. Record ambiguity, missing acceptance criteria, unsupported assumptions, and traceability gaps without rewriting source material. Present proposed corrections separately and cite stable evidence locations for every finding.',
    triggers: 'requirements review, quality review, traceability review',
    requiredContext: 'requirements sources, supporting context, traceability targets',
    inputs: 'requirements, supportingContext, traceabilityTargets',
    outputs: 'reviewReport, traceabilityMatrix, openQuestions',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Every finding cites evidence, Every requirement has a review result, Unsupported assumptions become open questions',
    estimatedContextTokens: 900
  },
  {
    ...SKILL_DEFAULTS,
    compatibility: 'Codex App Server, imagegen',
    id: 'ui-screen-generator',
    label: 'UI screen generator',
    name: 'UI screen generator',
    description: 'Generates consistent UI screen concepts from approved requirements and design guidance.',
    instructions: 'Read the approved requirements, design system, and screen inventory before generation. Create each screen with shared component and layout rules and save the generated images in the selected project folder. Inspect the set once per attempt and report only material visual or interaction differences, with affected screens and suggested changes. Minor cosmetic differences are advisory, not execution failures. Present the screens and report to the human review gate. Never regenerate automatically: revise only the screens the user explicitly selects, preserve accepted screens, and let the user continue with recorded tradeoffs.',
    triggers: 'generate UI screens, create mockups, screen concepts',
    requiredContext: 'requirements document, design guidance, screen inventory',
    inputs: 'requirements, designSystem, screenInventory',
    outputs: 'screenImages, generationPrompts, consistencyReport',
    requiredPermissions: 'workspace.read, workspace.write, image generation',
    validationCriteria: 'Every requested screen has a real saved image, Material consistency findings cite affected screens, No automatic regeneration occurs without a human revision decision, Screens do not invent unsupported capabilities',
    estimatedContextTokens: 1100
  },
  {
    ...SKILL_DEFAULTS,
    id: 'api-contract-reviewer',
    label: 'API contract reviewer',
    name: 'API contract reviewer',
    description: 'Checks API contracts for consistency, compatibility, security, and implementable error behavior.',
    instructions: 'Inspect the API contract and relevant domain models. Check request and response schemas, status codes, authentication, pagination, idempotency, versioning, and backward compatibility. Report exact contract locations and propose changes without modifying the source.',
    triggers: 'review API, OpenAPI review, contract validation',
    requiredContext: 'API specification, domain models, compatibility policy',
    inputs: 'apiSpecification, domainModels, compatibilityPolicy',
    outputs: 'contractFindings, compatibilityAssessment, proposedCorrections',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Every operation is reviewed, Breaking changes are identified, Error behavior is explicit',
    estimatedContextTokens: 850
  },
  {
    ...SKILL_DEFAULTS,
    id: 'test-case-designer',
    label: 'Test case designer',
    name: 'Test case designer',
    description: 'Derives traceable positive, negative, boundary, and failure-path test cases from requirements.',
    instructions: 'Map each testable requirement and acceptance criterion to one or more test cases. Include preconditions, inputs, steps, expected results, and evidence requirements. Identify untestable requirements as blockers instead of inventing expected behavior.',
    triggers: 'design tests, create test cases, acceptance test planning',
    requiredContext: 'requirements, acceptance criteria, system constraints',
    inputs: 'requirements, acceptanceCriteria, systemConstraints',
    outputs: 'testCases, coverageMatrix, testabilityGaps',
    requiredPermissions: 'workspace.read',
    validationCriteria: 'Every test maps to a requirement, Boundary and failure cases are covered, Expected results are observable',
    estimatedContextTokens: 800
  },
  {
    ...SKILL_DEFAULTS,
    id: 'accessibility-auditor',
    label: 'Accessibility auditor',
    name: 'Accessibility auditor',
    description: 'Audits UI implementations and interaction flows against documented accessibility requirements.',
    instructions: 'Inspect semantic structure, keyboard operation, focus behavior, labels, contrast evidence, errors, motion, and assistive-technology cues. Separate automated evidence from manual-review requirements. Prioritize findings by user impact and cite the affected component or screen.',
    triggers: 'accessibility audit, WCAG review, inclusive design review',
    requiredContext: 'UI source or screens, accessibility target, interaction flows',
    inputs: 'uiImplementation, accessibilityTarget, interactionFlows',
    outputs: 'accessibilityFindings, manualChecks, remediationPlan',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Findings cite affected UI, Keyboard paths are assessed, Manual checks are clearly separated',
    estimatedContextTokens: 900
  },
  {
    ...SKILL_DEFAULTS,
    id: 'security-threat-modeler',
    label: 'Security threat modeler',
    name: 'Security threat modeler',
    description: 'Builds evidence-backed threat models from architecture, data flow, and trust-boundary context.',
    instructions: 'Inventory assets, actors, entry points, data flows, and trust boundaries. Identify credible threats and map existing controls before proposing mitigations. Record missing architecture details as questions and include a verification method for each mitigation.',
    triggers: 'threat model, security design review, risk analysis',
    requiredContext: 'architecture diagrams, data flows, security requirements',
    inputs: 'architecture, dataFlows, securityRequirements',
    outputs: 'threatModel, riskRegister, mitigationPlan',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Trust boundaries are covered, Threats map to assets and controls, Every mitigation is verifiable',
    estimatedContextTokens: 1000
  },
  {
    ...SKILL_DEFAULTS,
    id: 'release-notes-compiler',
    label: 'Release notes compiler',
    name: 'Release notes compiler',
    description: 'Compiles verified user-facing release notes from approved changes and issue evidence.',
    instructions: 'Collect only changes included in the approved release scope. Group changes by user impact, distinguish fixes from new behavior, and link each statement to source evidence. Exclude internal-only details, secrets, and unsupported claims.',
    triggers: 'release notes, changelog, release summary',
    requiredContext: 'release scope, merged changes, issue references',
    inputs: 'releaseScope, changeRecords, issueReferences',
    outputs: 'releaseNotes, evidenceIndex, excludedChanges',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Every note maps to an approved change, No unsupported claims are included, Sensitive details are excluded',
    estimatedContextTokens: 650
  },
  {
    ...SKILL_DEFAULTS,
    id: 'incident-root-cause-analyst',
    label: 'Incident root-cause analyst',
    name: 'Incident root-cause analyst',
    description: 'Builds incident timelines and tests causal hypotheses against operational evidence.',
    instructions: 'Normalize timestamps and build a factual event timeline from the supplied evidence. Separate observations from hypotheses, test each causal claim, and identify contributing conditions. Recommend corrective actions that map directly to verified causes.',
    triggers: 'incident analysis, root cause analysis, post-incident review',
    requiredContext: 'incident evidence, logs, alerts, deployment history',
    inputs: 'incidentEvidence, operationalLogs, deploymentHistory',
    outputs: 'incidentTimeline, causalAnalysis, correctiveActions',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Timeline entries retain source evidence, Causes are distinguished from correlation, Actions map to verified causes',
    estimatedContextTokens: 1000
  },
  {
    ...SKILL_DEFAULTS,
    id: 'documentation-consistency-reviewer',
    label: 'Documentation consistency reviewer',
    name: 'Documentation consistency reviewer',
    description: 'Finds conflicting terminology, stale instructions, broken references, and coverage gaps across documentation.',
    instructions: 'Inventory the in-scope documentation and establish canonical terms and references. Compare duplicated guidance, commands, links, and version claims. Report conflicts with source locations and propose a coordinated correction plan.',
    triggers: 'documentation review, docs consistency, content audit',
    requiredContext: 'documentation root, terminology source, supported versions',
    inputs: 'documentationSet, terminologySource, supportedVersions',
    outputs: 'consistencyFindings, brokenReferences, correctionPlan',
    requiredPermissions: 'workspace.read, workspace.search',
    validationCriteria: 'Conflicts cite both sources, Broken references are listed, Proposed terminology follows the canonical source',
    estimatedContextTokens: 750
  },
  {
    ...SKILL_DEFAULTS,
    id: 'data-migration-validator',
    label: 'Data migration validator',
    name: 'Data migration validator',
    description: 'Validates mappings, transformations, reconciliation rules, and migration exception evidence.',
    instructions: 'Compare source and target contracts, then inspect every mapping and transformation rule. Validate reconciliation evidence against explicit tolerances and classify exceptions by impact. Never modify migration data while performing validation.',
    triggers: 'migration validation, reconciliation review, mapping review',
    requiredContext: 'source schema, target schema, mapping rules, reconciliation tolerances',
    inputs: 'sourceSchema, targetSchema, mappingRules, reconciliationEvidence',
    outputs: 'mappingFindings, reconciliationResults, exceptionRegister',
    requiredPermissions: 'workspace.read',
    validationCriteria: 'Every mapped field is assessed, Tolerances are explicit, Material exceptions remain visible',
    estimatedContextTokens: 900
  }
];
