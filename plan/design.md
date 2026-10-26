# Workflow Studio Design Direction

> Implementation reference: [design-system/README.md](../design-system/README.md). This document explains the product direction; the design-system folder is the reusable source of truth for tokens and components.

## Design name

**Structured Systems**

Structured Systems combines strong grid structure, geometric composition, visible system states, and technical character with rounded surfaces, subtle elevation, and dark/light themes for a credible enterprise developer product.

## Design principles

### 1. Clarity over decoration

Every visual element should explain workflow state, user action, system evidence, or risk. Decorative geometry should be used sparingly.

### 2. Structured density

Workflow tools need to display substantial information, but the interface should remain scannable through clear panels, spacing, labels, and hierarchy.

### 3. Technical confidence

The product should feel precise and dependable. Use consistent borders, alignment, status language, and predictable interaction patterns.

### 4. Evidence in the interface

Prompts, schemas, permissions, validation findings, events, artifacts, and approval decisions should be visible without feeling like raw debug output.

### 5. Professional Bauhaus influence

Retain geometric structure, asymmetric layouts, strong typography, and intentional accent colors. Avoid excessive novelty, oversized headlines, and heavy borders on every element.

### 6. Enterprise polish

Use rounded surfaces, subtle elevation, calm spacing, and familiar interaction patterns so the product feels suitable for professional engineering teams.

## Visual language

- Use a 12-column desktop grid with consistent gutters.
- Use rounded containers with a radius of 10–16px; reserve sharper shapes for badges and technical graph nodes.
- Use 1px borders for primary containers and internal structure.
- Use solid color fills rather than gradients.
- Use restrained, soft shadows only where they improve hierarchy or accessibility.
- Use compact uppercase labels for system metadata and status categories.
- Use normal sentence case for user-facing instructions and explanations.
- Keep important actions visible and avoid hiding workflow state in decorative UI.

## Color system

The product supports both light and dark modes. Theme switching must preserve semantic color meaning and readable contrast. New users inherit the operating-system preference; after a manual change, the selected theme is persisted locally under `workflow-studio-theme`.

| Token | Value | Usage |
| --- | --- | --- |
| `background` | `#F7F8FA` | Application background |
| `surface` | `#FFFFFF` | Cards, panels, forms |
| `surface-subtle` | `#F2F4F7` | Secondary regions and inactive areas |
| `text-primary` | `#172033` | Main text and headings |
| `text-secondary` | `#667085` | Supporting text and metadata |
| `border` | `#D0D5DD` | Borders and dividers |
| `primary` | `#2457D6` | Primary actions, links, active states |
| `primary-dark` | `#163A91` | Hover and pressed states |
| `warning` | `#D99000` | Approval requests, warnings, pending states |
| `error` | `#D92D20` | Failures, blocked actions, destructive actions |
| `success` | `#16805C` | Passed validation and completed states |
| `technical-panel` | `#172033` | Logs, prompts, and technical output |
| `technical-text` | `#F8FAFC` | Text on technical panels |

Dark-mode mappings use the same semantic tokens with these core surfaces: background `#0D1117`, surface `#151B24`, subtle surface `#1A222D`, text `#F2F4F7`, muted text `#A4ADBB`, and border `#2B3543`.

Color must not be the only status indicator. Pair colors with labels, icons, or text such as `RUNNING`, `PAUSED`, `PASSED`, and `BLOCKED`.

## Typography

- **Headings:** Space Grotesk, semibold or bold.
- **Body:** Inter, regular or medium.
- **Technical content:** IBM Plex Mono or another readable monospace font.
- Use strong scale contrast, but keep page titles below extreme poster-like sizes.
- Recommended desktop page title: 40–48px.
- Recommended section heading: 24–32px.
- Recommended body text: 14–16px.
- Recommended metadata label: 11–12px uppercase with moderate letter spacing.

## Layout and navigation

Use one unified dashboard and no persistent left navigation sidebar. The compact header contains brand, runtime state, theme, and user controls; it is not a second navigation system.

Workflow creation sits at the top, created workflows form the primary library below it, contextual graph and skill editors replace the library in place, and monitoring logs remain available in a persistent bottom dock.

Recommended page structure:

```text
Compact global header
└── Unified dashboard
    ├── Workflow creation + right-side harness defaults
    ├── Workflow library cards
    ├── Contextual graph editor + inspector
    ├── Skill registry
    └── Persistent monitoring dock
```

## Core screen guidance

### New workflow

- Make the workflow prompt the primary focus.
- Do not request a project or repository during reusable workflow creation.
- Present selected skills as compact, inspectable cards.
- Keep harness defaults visible but secondary.
- Use one clear primary action: `Generate plan`.

### Graph review

- Use a lightly tinted graph canvas with a subtle grid.
- Use node color sparingly by type: blue for Codex/agent work, amber for approvals, green for validation success, red for failures.
- Keep the node inspector open alongside the graph on large screens.
- Show unresolved ambiguities at the top with clear resolution actions.
- Make `Approve and compile` the primary action only after validation passes.

### Skill registry

- Provide search, filters, active/archived status, workspace scope, freshness, and size indicators.
- Show skill version, last updated date, source, estimated context size, and compatibility.
- Provide explicit `Edit`, `Duplicate`, `Archive`, and `Restore` actions.
- Use a dedicated detail panel or editor for instructions, inputs, outputs, permissions, and validation criteria.
- Show version history and prevent silent changes to workflows using older versions.

### Live monitor

- Keep execution status at the top: running, paused, waiting for approval, failed, or complete.
- Place the execution graph beside the selected node evidence.
- Use a dark technical panel for streamed Codex output, prompts, and event logs.
- Keep approval actions prominent and separate from diagnostic content.
- Show loop iterations, retry counts, artifacts, and validation findings near the relevant node.

### History and comparison

- Use a chronological run list with filters for status, workflow, workspace, and date.
- Show concise event summaries in each run card.
- Provide side-by-side version and artifact comparison.
- Make restore, export, and duplicate actions explicit and reversible where possible.

## Icons

- Use consistent SVG icons rather than text glyphs.
- Use 18–20px icons with approximately 2.25–2.5px stroke weight.
- Use rounded line caps and joins.
- Give icon-only controls at least a 34px hit area.
- Add hover, active, and selected states using the current theme tokens.
- Provide accessible labels for icon-only actions.

## Components

### Buttons

- Primary: blue fill with white text.
- Secondary: white or transparent fill with a border.
- Warning: amber fill for approval or pending decisions.
- Destructive: red fill only for rejection, deletion, or blocked-risk actions.
- Use sentence case for normal actions and compact uppercase labels for system actions.

### Cards and panels

- Theme-aware surface, 1px border, and 10–16px radius.
- Use subtle, soft shadows to establish hierarchy.
- Use a dark header only for technical evidence, logs, or strongly separated system output.
- Avoid nested borders wherever a divider or spacing is sufficient.

### Status badges

Use a colored dot or icon plus text. Recommended labels include `DRAFT`, `READY`, `RUNNING`, `PAUSED`, `WAITING FOR APPROVAL`, `PASSED`, `FAILED`, `STALE`, `ARCHIVED`, and `BLOCKED`.

### Forms

- Use full border inputs with clear labels.
- Show helper text for permissions, context size, schemas, and constraints.
- Keep advanced harness settings collapsible but discoverable.
- Always show validation errors next to the affected field.

## Responsive behavior

- Desktop: unified dashboard with graph, inspector, harness, and evidence panels.
- Tablet: stacked dashboard, inspector, and evidence panels.
- Mobile: prioritize workflow status, prompt editing, approvals, and run history; graph editing can become a readable step list.
- Never require horizontal scrolling for core actions.

## Accessibility

- Maintain WCAG-compliant contrast for text and controls.
- Provide keyboard access to navigation, graph selection, node inspection, approvals, and history actions.
- Use visible focus indicators.
- Pair status colors with text and icons.
- Provide accessible names for graph nodes, edges, buttons, and live updates.
- Respect reduced-motion preferences for event streams and transitions.

## Screen coverage

The design direction covers these product screens:

- New Workflow → prompt, workspace, skills, and harness configuration.
- Graph Review → graph canvas, node inspector, ambiguities, and compile action.
- Skill Registry → searchable skills, stale states, context size, editing, and version history.
- Live Run → execution graph, approval panel, Codex stream, prompts, and artifacts.
- Workflow History → searchable run list and status summaries.
- History Comparison → version diff, restore, and archived states.
- Template Library → reusable workflow discovery.


## Out of scope for the current product release

- Additional user-created themes beyond the supported light and dark modes.
- Free-form decorative canvas tooling unrelated to executable workflow graphs.
- Decorative animation unrelated to workflow state.
- Dense performance analytics beyond basic run metrics.
