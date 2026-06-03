/**
 * Preview deployment orchestrator.
 *
 * New architecture (file-based):
 *   1. Trigger GitHub Actions build in the fork
 *   2. Wait for build to finish
 *   3. Download the GitHub artifact (static site zip) onto Broadway's disk
 *   4. Mark preview as live — Broadway serves the files directly
 *
 * No separate Akash container is deployed per PR. This eliminates provider
 * reliability issues, hairpin-NAT problems, and the 500 MB image extraction
 * lottery that was causing 404s across multiple providers.
 *
 * Old Akash-container previews (providerUrl set, no filesPath) are still
 * proxied for backward compatibility.
 */

import { AkashConsoleClient } from "@/lib/akash/client";
import { startBuild, awaitBuild, getArtifactUrl } from "@/lib/github-build";
import { upsertRecord, patchRecord, deleteRecord, getRecord } from "@/lib/deploy/store";
import { downloadAndExtract, deletePreviewFiles } from "@/lib/deploy/file-store";

export interface DeployPreviewOptions {
  repo: string;
  prNumber: number;
  akashClient: AkashConsoleClient;
  depositUsd?: number; // kept for interface compat, unused in file-based flow
}

export interface DeployResult {
  previewUrl: string;
}

export async function deployPreview(opts: DeployPreviewOptions): Promise<DeployResult> {
  const { repo, prNumber } = opts;

  const domain = process.env.BROADWAY_DOMAIN ?? "akash.world";
  const previewUrl = `https://pr-${prNumber}.${domain}`;

  // Close any previous Akash deployment for this PR (old architecture).
  const prev = getRecord(repo, prNumber);
  if (prev?.dseq) {
    try {
      await opts.akashClient.closeDeployment(prev.dseq);
      console.log(`[deploy] Closed old Akash deployment dseq=${prev.dseq}`);
    } catch { /* already closed */ }
  }
  // Clean up old preview files if any.
  if (prev?.prNumber) {
    deletePreviewFiles(prev.prNumber);
  }

  upsertRecord({
    repo,
    prNumber,
    phase: "building",
    previewUrl,
    createdAt: new Date().toISOString(),
  });

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    // 1. Trigger build.
    console.log(`[deploy] Triggering build for ${repo} PR #${prNumber}…`);
    const run = await startBuild(prNumber, token);
    patchRecord(repo, prNumber, { buildRunUrl: run.htmlUrl });

    await awaitBuild(run.id, token);
    console.log(`[deploy] Build complete (run ${run.id})`);

    // 2. Download artifact and extract to Broadway's persistent volume.
    patchRecord(repo, prNumber, { phase: "deploying" });
    console.log(`[deploy] Downloading preview artifact…`);

    const artifactUrl = await getArtifactUrl(run.id, prNumber, token);
    const filesPath = await downloadAndExtract(artifactUrl, prNumber, token);

    // 3. Mark live — no Akash deployment needed.
    patchRecord(repo, prNumber, {
      phase: "live",
      filesPath,
    });

    console.log(`[deploy] PR #${prNumber} live at ${previewUrl} (files: ${filesPath})`);
    return { previewUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[deploy] Failed for ${repo} PR #${prNumber}: ${msg}`);
    patchRecord(repo, prNumber, { phase: "failed", error: msg });
    throw err;
  }
}

/**
 * Retry just the download+extract step when a build already succeeded.
 * Useful if the artifact download failed or files got corrupted.
 */
export async function retryDeploy(opts: DeployPreviewOptions): Promise<DeployResult> {
  const { repo, prNumber } = opts;

  const record = getRecord(repo, prNumber);
  if (!record?.buildRunUrl) {
    throw new Error("No successful build found for this PR — run a full deploy first.");
  }

  // Extract run ID from the build URL.
  const runIdMatch = record.buildRunUrl.match(/runs\/(\d+)/);
  if (!runIdMatch) throw new Error("Could not parse run ID from buildRunUrl");
  const runId = parseInt(runIdMatch[1], 10);

  console.log(`[retry] Re-downloading artifact for PR #${prNumber} from run ${runId}`);
  patchRecord(repo, prNumber, { phase: "deploying", error: undefined });

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const artifactUrl = await getArtifactUrl(runId, prNumber, token);
    const filesPath = await downloadAndExtract(artifactUrl, prNumber, token);

    const domain = process.env.BROADWAY_DOMAIN ?? "akash.world";
    patchRecord(repo, prNumber, { phase: "live", filesPath });

    console.log(`[retry] PR #${prNumber} live (files: ${filesPath})`);
    return { previewUrl: `https://pr-${prNumber}.${domain}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchRecord(repo, prNumber, { phase: "failed", error: msg });
    throw err;
  }
}

export async function teardownPreview(
  repo: string,
  prNumber: number,
  akashClient: AkashConsoleClient
): Promise<void> {
  const record = getRecord(repo, prNumber);
  if (!record) return;

  // Close Akash deployment if this was an old container-based preview.
  if (record.dseq) {
    try {
      await akashClient.closeDeployment(record.dseq);
    } catch { /* already closed */ }
  }

  // Delete static files from disk.
  deletePreviewFiles(prNumber);

  deleteRecord(repo, prNumber);
  console.log(`[teardown] PR #${prNumber} torn down`);
}
