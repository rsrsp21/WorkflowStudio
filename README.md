# Workflow Studio

Workflow Studio turns a user-authored outcome into a visible, governed workflow of focused Codex stages, reusable skills, typed handoffs, revision loops, human decision gates, and traceable local actions. It is domain-neutral: product planning is one editable example, not a fixed product path.

## Run locally

Use Node.js 24.15.x, authenticate Codex, install dependencies, and start the web app:

```powershell
npm install
npm run runtime:login
npm run dev
```

Open `http://localhost:3000`. Direct local App Server mode is the development default. To exercise the same per-user architecture used by any deployed installation, set `CODEX_RUNTIME_MODE=paired` and follow [the companion guide](./docs/local-runtime-companion.md).

Companion 0.2.0 adds durable result replay and server-owned continuation. Workflows can use explicit fork/join nodes and a concurrency budget for parallel read-only work; project writers remain exclusive. See [configuration, recovery and upgrade instructions](./docs/runtime-reliability-and-parallel.md).

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Product requirements and delivery status are tracked in [requirements.md](./requirements.md) and [plan/README.md](./plan/README.md).

## Standalone local companion

End users extract the separate Next.js companion ZIP, open PowerShell in its folder, and run `& ".\app\tools\node\node.exe" ".\start.cjs"`. It includes portable Node/npm and runs setup automatically. BAT launchers are optional. Build with `npm run companion:build` and package with `npm run companion:package`. See [companion distribution and setup](./docs/companion-distribution.md).

Database and companion integration: [local PostgreSQL / Aiven setup](./docs/database-setup.md).

Company demo, production settings, role setup, load smoke testing, and launch gates: [company launch runbook](./docs/company-launch.md).
