# Workflow Studio Companion setup

The companion is a local Next.js app opened in the user's browser. The separate ZIP contains companion source and portable Node/npm. It contains no Electron and no main website/backend source. First launch installs dependencies from npm and builds automatically.

Open PowerShell in the extracted **Workflow-Studio-Companion** folder and run `& ".\app\tools\node\node.exe" ".\start.cjs"`. This is the primary startup method. The same command handles first-time setup and later launches; the BAT files are optional.

## User setup

1. On the deployed website open **Profile → Local runtime** and download the approved companion ZIP.
2. Extract the ZIP and open the extracted **Workflow-Studio-Companion** folder. It contains **app**, **start.bat**, **stop.bat**, **start.cjs**, and **RUNNING-INSTRUCTIONS.txt**.
3. Open PowerShell in that folder and run `& ".\app\tools\node\node.exe" ".\start.cjs"`. Wait for first-time setup; the local companion opens in your browser.
4. Click **Browse…**, select a parent folder, then **Create WorkflowStudio here**. Or enter an absolute dedicated path such as D:\WorkflowStudio and click **Use folder**.
5. Click **Sign in with Codex**, complete browser sign-in, and return to the companion.
6. On the website select **Profile → Local runtime → Generate pairing code** and copy it.
7. In the companion's **Enter your pairing code** section, enter the website address, paste the code, and click **Connect**. Codes expire after ten minutes and work once.
8. Wait for **Connected**, then create projects and run workflows from the website. Workflows are reusable across the user's projects. Local projects live inside the selected folder's projects directory, with private app skills and agents in that workspace.

Keep PowerShell open. You may close the browser tab. Run the same command to reopen the companion; later launches skip completed setup and resume the saved connection. Use **Pause runtime** to pause and the red **Stop companion** button to stop the service. The BAT launchers are optional. Pause before selecting another workspace. Existing files are not moved.

## Administrator packaging and deployment

Run npm --prefix companion install, npm run companion:build, then npm run companion:package from the development checkout. Output: release/companion-next/Workflow-Studio-Companion-0.2.0-win-x64.zip plus its SHA-256 file. Packaging downloads official portable Node.js 24.15.0 for Windows x64 and verifies its checksum. Only the companion allowlist and required runtime helpers are included; database configuration, credentials, and main app code are excluded.

For a production release, create an Ed25519 key in an approved secret location and keep the private key outside the repository:

```powershell
openssl genpkey -algorithm ED25519 -out C:\secure\workflow-studio-companion-private.pem
$env:WORKFLOW_STUDIO_COMPANION_SIGNING_KEY_FILE='C:\secure\workflow-studio-companion-private.pem'
npm run companion:package
npm run companion:verify -- release\companion-next\Workflow-Studio-Companion-0.2.0-win-x64.zip release\companion-next\Workflow-Studio-Companion-0.2.0-win-x64.zip.sig.json release\companion-next\Workflow-Studio-Companion-0.2.0-win-x64.zip.public.pem
```

Publish the ZIP, `.sha256`, `.sig.json`, and public PEM through the approved HTTPS channel. Store the private key only in the release secret store. Configure the download, signature, and public-key URLs on the server; the Setup guide exposes the integrity files to users and IT reviewers.

For local qualification, `npm run companion:package -- --qualification` creates a separate package under `release/companion-qualification` with an ephemeral qualification key. It does not replace public downloads or a production signing key. Companion 0.2.0 is required for the updated focused execution protocol; see [durable delivery and parallel setup](./runtime-reliability-and-parallel.md).

Packaging also copies the ZIP to public/downloads/workflow-studio-companion.zip. Include the public folder in the website deployment and restart the website; the landing, Studio, and Profile download controls will serve it automatically. Alternatively publish the ZIP to an approved HTTPS download location and set WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL to override the built-in download. Set CODEX_RUNTIME_MODE=paired on the server. Validate real sign-in, pairing, and a workflow run against the deployment before distributing broadly. The companion never needs PostgreSQL credentials; database access belongs to the server.

The local UI listens only on 127.0.0.1 and requires a launcher session cookie. Mutating requests require the local origin and request header. Runtime traffic to a deployed website uses outbound HTTPS. Workspace credentials stay in the selected folder; launcher settings are in the user's WorkflowStudio/runtime/companion directory.

Company policy must permit portable Node, npm downloads, and native Codex. BAT permission is not required for the primary PowerShell startup method. This package does not bypass application-control rules. Removing it does not delete workspace files.

The launcher enables Node's standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment handling for corporate networks. Heartbeats report the companion and protocol versions. An incompatible server responds with an update-required status, and the companion stops with instructions to download the current ZIP instead of continuing with an unsafe protocol mismatch.
