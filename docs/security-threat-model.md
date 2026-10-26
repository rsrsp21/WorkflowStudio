# Workflow Studio security threat model

This model covers the deployed Workflow Studio control plane, PostgreSQL, browser sessions, organization libraries, and the source-based local companion. Review it for every release that changes authentication, tenancy, pairing, local file access, approvals, artifact delivery, or integrations.

## Assets and trust boundaries

Protected assets are account credentials, session tokens, pairing and runtime tokens, PostgreSQL credentials, workflow definitions, project paths, prompts, outputs, artifacts, approvals, audit history, local Codex authentication, installed app skills, and local workspace files.

The browser crosses an HTTPS boundary into the control plane. Web instances cross a TLS database boundary into PostgreSQL. A companion crosses an outbound HTTPS boundary into the runtime API and then a local process boundary into Codex App Server. Local files remain behind the companion boundary. Organization membership is a separate authorization boundary; membership never grants access to another member's companion, private projects, runs, or personal workflow edits.

## Threats, controls, and evidence

| Threat | Required control | Verification evidence |
| --- | --- | --- |
| Credential theft | Passwords use salted scrypt hashes; session and runtime tokens are random and stored only as SHA-256 hashes; cookies are HTTP-only, same-site, and secure in production; secrets come from the deployment secret store. | Authentication ownership tests, runtime pairing tests, support-bundle redaction tests, production preflight. |
| Cross-site mutation | Mutation requests reject foreign `Origin` and `Sec-Fetch-Site`; cookies use strict same-site policy; CSP blocks framing and foreign form actions. | Request-security tests and deployed header inspection. |
| Cross-tenant data access | Every personal repository query includes user ID; organization APIs require current membership; administrator and delegated reviewer paths are explicit and audited; nonmembers receive a generic not-found response for shared libraries. | Ownership, project routing, reviewer delegation, artifact access, and organization tenancy tests. |
| Privilege escalation | Signup ignores requested roles; only administrators change product roles; organization owners and administrators manage membership; only the current owner transfers ownership; protected owner removal fails. | Role-governance and organization transfer tests. |
| Approval bypass or replay | Allowed decisions are compiled into the gate; invalid and stale decisions do not resume execution; separate reviewer policy and delegation are enforced server-side; tool approvals expire and bind to user, run, job, and request ID. | Approval validation, Mastra suspension/resumption, reviewer queue, and tool-approval tests. |
| Pairing theft or replay | Pairing codes are high-entropy, short-lived, hashed, and atomically claimed once; runtime tokens bind to one user and connection; revocation clears the token hash. | Multi-instance qualification and paired-runtime ownership tests. |
| Duplicate work after failover | Runtime work has a stable execution key; PostgreSQL uses atomic job claims, leases, fencing IDs, renewal, and idempotent completion; run execution locks are database-backed. | PostgreSQL coordination tests and two-instance qualification. |
| Local workspace escape | The companion replaces inherited Codex home variables with a dedicated app home; canonical path checks reject traversal and junction escapes; each job carries approved roots and sandbox policy; destructive local actions require approval. | Studio-home isolation, workspace boundary, companion policy, and local approval tests. |
| Malicious or oversized output | Runtime output must be JSON, match declared keys and types, and stay below size limits; artifacts have count, size, root, and permission checks; previews use owned IDs rather than arbitrary paths. | Runtime contract, artifact, and API safety tests. |
| Sensitive data in logs or exports | Diagnostics and support bundles redact tokens and secret-shaped values; Prometheus metrics contain aggregates only; public health/version endpoints contain compatibility metadata only. | Observability, redaction, support-bundle, and metrics authorization tests. |
| Database corruption or destructive recovery | Versioned migrations use checksums; audit rows reject update/delete; backups restore only with explicit confirmation into a separate target; deterministic table fingerprints compare source and restore. | Schema verifier, immutable-audit test, backup/restore comparison report. |
| Supply-chain package substitution | Dependencies are locked; production dependency audit must be clean; the companion ZIP gets a SHA-256 file and production releases require an Ed25519 detached signature and published public key. | `npm audit --omit=dev`, companion signature test, `npm run companion:verify`. |
| Denial of service | Shared PostgreSQL rate-limit buckets protect public authentication routes; request, output, artifact, history, and concurrency limits are bounded; readiness removes unhealthy instances; queue and lease metrics alert operators. | Rate-limit tests, load reports, readiness and Prometheus metrics. |

## Residual risks and release decisions

- Codex service capacity, corporate proxy behavior, endpoint protection, and user device performance are outside the control plane. Qualify them with real canary companions.
- The ZIP is source-based and does not use an operating-system installer. A detached signature proves artifact origin when the public key is distributed through an approved channel; company IT must still approve the download and execution path.
- PostgreSQL contains workflow and run content. Production access, encryption, backup retention, and point-in-time recovery are controlled by the database platform and must be verified in the company environment.
- Organization sharing currently exposes only approved workflow definitions. It does not share personal projects, run history, companion access, or editable ownership.
- Penetration testing and accessibility review require the final deployed origin and company identity/network controls. Findings must be resolved or explicitly accepted before broad promotion.

## Release review

Security review must confirm the exact release ID, database schema, companion checksum/signature, dependency audit, role and reviewer settings, HTTPS origin, PostgreSQL TLS, backup restore evidence, retention policy, and monitoring alerts. Any change to a trust boundary requires updating this document and adding a failing regression test before promotion.
