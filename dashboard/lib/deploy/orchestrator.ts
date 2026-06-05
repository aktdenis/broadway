import { AkashConsoleClient } from "@/lib/akash/client";
import { startBuild, startBranchBuild, awaitBuild, getArtifactUrl } from "@/lib/github-build";
import { upsertRecord, patchRecord, deleteRecord, getRecord, branchToSlug } from "@/lib/deploy/store";
import { downloadAndExtract, deletePreviewFiles } from "@/lib/deploy/file-store";

export interface DeployPreviewOptions {
  repo: string;
  prNumber: number;
  akashClient: AkashConsoleClient;
  depositUsd?: number;
}

export interface DeployBranchOptions {
  branchRef: string;   // e.g. "feat/my-feature"
  branchRepo: string;  // e.g. "aktdenis/akash-network-website"
  akashClient: AkashConsoleClient;
}

export interface DeployResult {
  previewUrl: string;
  slug: string;
}

// ── Shared deploy step ────────────────────────────────────────────────────────

async function runBuildAndExtract(
  slug: string,
  runId: number,
  token: string
): Promise<string> {
  const artifactUrl = await getArtifactUrl(runId, slug, token);
  return downloadAndExtract(artifactUrl, slug, token);
}

// ── PR deploy ─────────────────────────────────────────────────────────────────

export async function deployPreview(opts: DeployPreviewOptions): Promise<DeployResult> {
  const { repo, prNumber, akashClient } = opts;
  const slug = `pr-${prNumber}`;
  const domain = process.env.BROADWAY_DOMAIN ?? "akash.world";
  const previewUrl = `https://${slug}.${domain}`;

  // Close old Akash deployment if any (old architecture).
  const prev = getRecord(slug);
  if (prev?.dseq) {
    try { await akashClient.closeDeployment(prev.dseq); } catch { /* already closed */ }
  }
  if (prev?.prNumber) deletePreviewFiles(slug);

  upsertRecord({
    repo, prNumber, slug, phase: "building", previewUrl,
    sourceType: "pr", createdAt: new Date().toISOString(),
  });

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const run = await startBuild(prNumber, token);
    patchRecord(slug, { buildRunUrl: run.htmlUrl });
    await awaitBuild(run.id, token);

    patchRecord(slug, { phase: "deploying" });
    const filesPath = await runBuildAndExtract(slug, run.id, token);
    patchRecord(slug, { phase: "live", filesPath });

    console.log(`[deploy] PR #${prNumber} live at ${previewUrl}`);
    return { previewUrl, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchRecord(slug, { phase: "failed", error: msg });
    throw err;
  }
}

// ── Branch deploy ─────────────────────────────────────────────────────────────

export async function deployBranch(opts: DeployBranchOptions): Promise<DeployResult> {
  const { branchRef, branchRepo, akashClient } = opts;
  const slug = `branch-${branchToSlug(branchRef)}`;
  const domain = process.env.BROADWAY_DOMAIN ?? "akash.world";
  const previewUrl = `https://${slug}.${domain}`;

  // Clean up previous deploy for this branch if any.
  const prev = getRecord(slug);
  if (prev?.dseq) {
    try { await akashClient.closeDeployment(prev.dseq); } catch { /* already closed */ }
  }
  deletePreviewFiles(slug);

  upsertRecord({
    repo: branchRepo, prNumber: 0, slug,
    phase: "building", previewUrl, sourceType: "branch",
    branchRef, branchRepo, createdAt: new Date().toISOString(),
  });

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const run = await startBranchBuild(branchRef, branchRepo, token);
    patchRecord(slug, { buildRunUrl: run.htmlUrl });
    await awaitBuild(run.id, token);

    patchRecord(slug, { phase: "deploying" });
    const filesPath = await runBuildAndExtract(slug, run.id, token);
    patchRecord(slug, { phase: "live", filesPath });

    console.log(`[deploy] Branch ${branchRef} live at ${previewUrl}`);
    return { previewUrl, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchRecord(slug, { phase: "failed", error: msg });
    throw err;
  }
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export async function retryDeploy(
  opts: DeployPreviewOptions | { slug: string; akashClient: AkashConsoleClient }
): Promise<DeployResult> {
  const slug = "slug" in opts ? opts.slug : `pr-${opts.prNumber}`;
  const record = getRecord(slug);
  if (!record?.buildRunUrl) {
    throw new Error("No successful build found — run a full deploy first.");
  }

  const runIdMatch = record.buildRunUrl.match(/runs\/(\d+)/);
  if (!runIdMatch) throw new Error("Could not parse run ID from buildRunUrl");
  const runId = parseInt(runIdMatch[1], 10);

  patchRecord(slug, { phase: "deploying", error: undefined });

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    const filesPath = await runBuildAndExtract(slug, runId, token);
    patchRecord(slug, { phase: "live", filesPath });

    return { previewUrl: record.previewUrl, slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchRecord(slug, { phase: "failed", error: msg });
    throw err;
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

export async function teardownPreview(
  repo: string,
  prNumber: number,
  akashClient: AkashConsoleClient
): Promise<void> {
  const slug = `pr-${prNumber}`;
  const record = getRecord(slug);
  if (!record) return;
  if (record.dseq) {
    try { await akashClient.closeDeployment(record.dseq); } catch { /* already closed */ }
  }
  deletePreviewFiles(slug);
  deleteRecord(slug);
  console.log(`[teardown] ${slug} torn down`);
}

export async function teardownBySlug(
  slug: string,
  akashClient: AkashConsoleClient
): Promise<void> {
  const record = getRecord(slug);
  if (!record) return;
  if (record.dseq) {
    try { await akashClient.closeDeployment(record.dseq); } catch { /* already closed */ }
  }
  deletePreviewFiles(slug);
  deleteRecord(slug);
  console.log(`[teardown] ${slug} torn down`);
}
