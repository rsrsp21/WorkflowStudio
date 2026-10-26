# Phase 1 Tasks: Project Foundation and Data Model

**Parent phase:** [Phase 1 — Foundation](../phase-01-foundation.md)  
**Schedule:** Days 1–2  
**Current status:** Complete.

## Task status

| ID | Task | Status |
| --- | --- | --- |
| P1-T01 | Set up Next.js and TypeScript project foundation | Done |
| P1-T02 | Define typed workflow domain model | Done |
| P1-T03 | Define safe harness defaults | Done |
| P1-T04 | Add local persistence boundaries | Done |
| P1-T05 | Create Codex and Mastra adapter boundaries | Done |
| P1-T06 | Build initial application shell and workspace screen | Done |
| P1-T07 | Add responsive enterprise UI, icons, and themes | Done |
| P1-T08 | Verify development and production builds | Done |
| P1-T09 | Add public landing, authentication, and account-aware navigation | Done |
| P1-T10 | Add PostgreSQL users, secure sessions, and workflow ownership | Done |
| P1-T11 | Standardize product navigation, icons, placeholders, and scrolling | Done |

## Detailed tasks

### P1-T01 — Set up Next.js and TypeScript project foundation

- Configure Next.js App Router.
- Add TypeScript configuration and Next.js type declarations.
- Add development, production build, and start scripts.
- Use a single Next.js runtime instead of a separate Node server and static browser app.

**Status:** Done.

### P1-T02 — Define typed workflow domain model

- Define `WorkflowPlan`, `WorkflowNode`, `WorkflowEdge`, and `WorkflowStatus`.
- Define supported node types.
- Add schema versioning.
- Add workflow draft creation.
- Add validation for required fields, node identifiers, edges, retry limits, and loop limits.

**Status:** Done in [models.ts](../../src/domain/models.ts).

### P1-T03 — Define safe harness defaults

- Default to read-only sandbox mode.
- Default to bounded retries and loop iterations.
- Default to one concurrent node.
- Default to no allowed tools or workspace paths.
- Require approval for destructive actions.

**Status:** Done in `DEFAULT_HARNESS_POLICY`.

### P1-T04 — Add local persistence boundaries

- Add a generic typed JSON store.
- Persist local product records under the configured `data` directory.
- Support reading all records and upserting by ID.
- Keep generated local records out of source control.

**Status:** Done. Projects, skills, and supporting workspace records use the PostgreSQL workspace repositories. Users, sessions, and user-owned workflow plans use the asynchronous PostgreSQL layer in [async-database.ts](../../src/storage/async-database.ts) and [workflow-repository.ts](../../src/storage/workflow-repository.ts).

### P1-T05 — Create Codex and Mastra adapter boundaries

- Define a typed Codex planning request.
- Define Codex planning and focused-task methods.
- Define Mastra compile and execute methods.
- Keep runtime integration separate from UI and persistence.

**Status:** Done in [codex-adapter.ts](../../src/adapters/codex-adapter.ts), [codex-app-server-adapter.ts](../../src/adapters/codex-app-server-adapter.ts), [codex-cli-adapter.ts](../../src/adapters/codex-cli-adapter.ts), and [mastra-adapter.ts](../../src/adapters/mastra-adapter.ts). Codex App Server is now the primary planning implementation with CLI fallback; Mastra runtime execution remains a later-phase integration.

### P1-T06 — Build initial application shell and workspace screen

- Add root layout and home page.
- Add project, workflow, canvas, harness, monitor, and history navigation placeholders.
- Add workflow name, workspace path, planning prompt, and constraints fields.
- Add local health status.
- Add saved workflow listing.

**Status:** Done in [layout.tsx](../../src/app/layout.tsx), [page.tsx](../../src/app/page.tsx), and the routed studio components. The final shell has no top navigation or left sidebar inside the studio: it uses a focused dashboard plus separate graph and skill routes, with each content workspace owning its scroll behavior.

### P1-T07 — Add responsive enterprise UI, icons, and themes

- Add Structured Systems visual language.
- Add rounded surfaces, subtle borders, and theme-aware shadows.
- Add stronger custom SVG icons.
- Add light and dark mode toggle.
- Use system preference for first-time users.
- Persist manual theme choice under `workflow-studio-theme`.
- Add responsive behavior for tablet and mobile layouts.

**Status:** Done in [globals.css](../../src/app/globals.css) and the workspace component. Decorative eyebrow/status text is hidden in favor of plain-language labels, and separate wide-logo and square-favicon assets prevent browser-icon distortion.

### P1-T08 — Verify development and production builds

- Install project dependencies.
- Run the Next.js development server.
- Verify `/api/health`.
- Save and reload a workflow through `/api/workflows`.
- Run `npm run build`.
- Confirm the production server starts successfully.

**Status:** Done. Development startup, API health, workflow save/reload, and the Next.js production build were successfully verified. Node.js `24.15.0` is pinned to avoid unsupported alpha-runtime and npm compatibility warnings, and development/build output directories are separated to prevent stale artifact conflicts.

### P1-T09 — Add public landing, authentication, and account-aware navigation

- Add a dedicated public landing page and keep the working application at `/studio`.
- Add signup, login, logout, and current-user routes.
- Capture name, email, password, and role during signup.
- Redirect authenticated users from login/signup to the studio.
- Route internal back actions and internal logos to `/studio`.
- Route the public logo to the landing page while signed out and to `/studio` while signed in.
- Show Login and Sign up actions to signed-out visitors and studio/sign-out actions to signed-in users.

**Status:** Done. Public, authentication, and studio routes are separated; account-aware landing navigation and protected studio/graph/skill pages are implemented.

### P1-T10 — Add PostgreSQL users, secure sessions, and workflow ownership

- Store users, sessions, and workflow plans in a PostgreSQL database.
- Hash passwords with a unique salt and scrypt; never persist plaintext passwords.
- Use random, expiring, HTTP-only, same-site session cookies.
- Store `user_id` on every workflow and enforce ownership when listing, saving, assigning, updating, or deleting it.
- Prevent one authenticated user from reading, replacing, assigning, or deleting another user's workflow.
- Import legacy JSON workflows into the first local account once so existing work is not silently lost.

**Status:** Done. PostgreSQL-backed authentication and workflow ownership are implemented with cross-user isolation tests. Account roles are stored as metadata; role-specific permissions remain a later product task.

### P1-T11 — Standardize product navigation, icons, placeholders, and scrolling

- Remove inconsistent icon-size overrides and use one 20 px, 2.4 stroke SVG standard across landing and studio controls.
- Use stronger, consistently sized icon buttons.
- Add example placeholders to authentication and skill-creation fields.
- Ensure login and signup own their vertical scroll container even though the application shell disables body scrolling.
- Keep authentication forms usable on short and mobile viewports.

**Status:** Done. Shared icon tokens, visible input guidance, authentication-page scrolling, and responsive short-screen spacing are implemented and covered by UI contract tests.

## Phase 1 acceptance checklist

- [x] Next.js + TypeScript project structure exists.
- [x] Typed workflow model and schema version exist.
- [x] Safe harness defaults exist.
- [x] Local persistence exists.
- [x] Codex and Mastra boundaries exist.
- [x] Initial workspace UI exists.
- [x] Light/dark theme and responsive styling exist.
- [x] Current Next.js development and production builds are verified.
- [x] Public landing, signup, login, logout, and protected product routes exist.
- [x] Passwords are hashed and sessions use HTTP-only cookies.
- [x] Workflows are stored with an owning user ID and isolated across users.
- [x] Internal navigation returns to `/studio`, while public logo routing is authentication-aware.
- [x] Icons, form placeholders, and authentication-page scrolling use consistent product-wide rules.
