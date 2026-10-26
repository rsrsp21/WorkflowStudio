# Workflow Studio Design System

This is the visual source of truth for Workflow Studio. New screens and components should follow these rules before adding one-off styles.

## Product direction

**Structured Systems** is a modern enterprise workflow console. It combines clear information architecture with calm, rounded surfaces and strong technical evidence. The interface should feel dependable, focused, and polished rather than decorative.

## Design principles

- **Clarity first:** Every element should communicate an action, state, risk, or piece of evidence.
- **Structured density:** Show complex workflow information through grouping, spacing, and hierarchy.
- **Calm confidence:** Use restrained color, subtle elevation, and consistent controls.
- **Evidence is visible:** Prompts, schemas, permissions, events, artifacts, and approvals should be easy to inspect.
- **Familiar interaction:** Use patterns users already understand for navigation, forms, status, search, and approvals.
- **Progressive disclosure:** Keep the primary workflow simple while making advanced harness details discoverable.
- **Accessible by default:** Never use color alone to communicate status; maintain keyboard focus and readable contrast.

## Themes

The app supports light and dark modes. A new user inherits the operating-system preference. Once the user changes the theme, the preference is saved in browser storage under `workflow-studio-theme`.

### Light theme

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F5F7FB` | App background |
| `surface` | `#FFFFFF` | Cards, panels, forms |
| `surface-subtle` | `#F8F9FC` | Secondary surfaces and list rows |
| `text` | `#172033` | Primary text |
| `muted` | `#6B7280` | Supporting text |
| `faint` | `#98A2B3` | Placeholders and disabled content |
| `border` | `#E5E7EB` | Borders and dividers |
| `primary` | `#4169E1` | Actions, links, active states |
| `primary-soft` | `#EEF2FF` | Selected and informational surfaces |
| `sidebar` | `#FBFCFE` | Navigation background |

### Dark theme

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#0D1117` | App background |
| `surface` | `#151B24` | Cards, panels, forms |
| `surface-subtle` | `#1A222D` | Secondary surfaces and list rows |
| `text` | `#F2F4F7` | Primary text |
| `muted` | `#A4ADBB` | Supporting text |
| `faint` | `#7B8798` | Placeholders and disabled content |
| `border` | `#2B3543` | Borders and dividers |
| `primary` | `#7C9CFF` | Actions, links, active states |
| `primary-soft` | `#202D50` | Selected and informational surfaces |
| `sidebar` | `#111821` | Navigation background |

### Semantic status colors

| Status | Value | Meaning |
| --- | --- | --- |
| Success | `#32B583` | Passed, connected, complete |
| Warning | `#D99000` | Pending, approval required, stale |
| Error | `#D92D20` | Failed, blocked, destructive |

Always pair status color with a text label or icon, for example `RUNNING`, `PAUSED`, `PASSED`, or `BLOCKED`.

## Typography

- **Interface font:** Inter.
- **Display and headings:** Inter, semibold or bold with tight letter spacing.
- **Technical content:** DM Mono for prompts, schemas, identifiers, and logs.
- Page title: 29–40px.
- Section heading: 18px.
- Body: 13–14px.
- Metadata: 10–12px.
- Eyebrow labels: 10px, uppercase, semibold, increased letter spacing.

## Shape and elevation

- Standard panels: 16px radius.
- Inputs and list rows: 9–10px radius.
- Buttons: 8–9px radius.
- Avatars and status badges: fully rounded.
- Use 1px borders with subtle shadows for separation.
- Do not use gradients or hard offset shadows in the primary enterprise UI.
- Technical evidence panels may use a darker surface for contrast.

## Icons

- Use consistent SVG icons rather than text glyphs or mixed icon styles.
- Default size: 18–20px.
- Default stroke width: approximately 2.25–2.5px.
- Use round line caps and joins.
- Give interactive icons a minimum 34px hit area.
- Use a soft background and hover state for icon-only controls.
- Icons must have an accessible label when they are the only control content.

## Layout

- Desktop uses a persistent navigation rail and a flexible content area.
- Use generous outer spacing and compact internal grouping.
- Keep the primary action in a predictable location.
- Pair the main workspace with a context, inspector, harness, or evidence panel.
- On small screens, hide the desktop rail and prioritize the main task, status, approvals, and history.

## Component rules

### Navigation

Use a subtle active background and primary-color indicator. Avoid large saturated blocks that compete with the main content.

### Forms

Use visible labels, rounded bordered fields, clear helper text, and inline validation. Advanced harness settings may be collapsed, but their existence should be discoverable.

### Buttons

- Primary: primary color fill with high-contrast text.
- Secondary: surface fill with border.
- Destructive: error color and explicit destructive wording.
- Approval: warning color only when a decision is pending.

### Workflow status

Use a label, icon, or badge in addition to color. Status should be understandable in grayscale.

### Technical evidence

Use dark panels for streamed Codex output, prompts, schemas, and event logs. Preserve readable monospace text and clear event prefixes.

## Reference

The detailed screen-by-screen design rationale remains in [plan/design.md](../plan/design.md).
