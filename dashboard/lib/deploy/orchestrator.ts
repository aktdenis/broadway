import { AkashConsoleClient } from "@/lib/akash/client";
import { buildPreviewSdl, prImageRef } from "@/lib/akash/sdl";
import { startBuild, awaitBuild } from "@/lib/github-build";
import { upsertRecord, patchRecord, deleteRecord, getRecord } from "@/lib/deploy/store";

export interface DeployPreviewOptions {
  repo: string;        // e.g. "akash-network/website"
  prNumber: number;
  akashClient: AkashConsoleClient;
  depositUsd?: number; // defaults to $2.00
}

export interface DeployResult {
  dseq: string;
  previewUrl: string;
}

export async function deployPreview(opts: DeployPreviewOptions): Promise<DeployResult> {
  const { repo, prNumber, akashClient, depositUsd = 2.0 } = opts;

  const domain = process.env.BROADWAY_DOMAIN ?? "akash.world";
  const previewUrl = `https://pr-${prNumber}.${domain}`;

  // Capture any existing deployment for this PR so we can close it after
  // recording the new build — re-deploys must not orphan the old Akash lease.
  const prev = getRecord(repo, prNumber);

  // Record immediately so the dashboard shows progress — and so any early
  // failure (e.g. missing token) surfaces as a visible "failed" row.
  upsertRecord({
    repo,
    prNumber,
    phase: "building",
    previewUrl,
    createdAt: new Date().toISOString(),
  });

  if (prev?.dseq) {
    try {
      await akashClient.closeDeployment(prev.dseq);
      console.log(`[deploy] Closed previous dseq=${prev.dseq} before re-deploy`);
    } catch (e) {
      console.error(`[deploy] Could not close previous dseq ${prev.dseq}:`, e);
    }
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");

    // 1. Build the PR into an image via the fork's GitHub Actions workflow.
    console.log(`[deploy] Triggering build for ${repo} PR #${prNumber}…`);
    const run = await startBuild(prNumber, token);
    patchRecord(repo, prNumber, { buildRunUrl: run.htmlUrl });
    await awaitBuild(run.id, token);
    console.log(`[deploy] Build complete`);

    // 2. Deploy the freshly built image to Akash.
    patchRecord(repo, prNumber, { phase: "deploying" });
    const imageRef = prImageRef(prNumber);
    const sdl = buildPreviewSdl(imageRef);

    const { dseq, manifest } = await akashClient.createDeployment(sdl, depositUsd);
    patchRecord(repo, prNumber, { dseq });
    console.log(`[deploy] Deployment created: dseq=${dseq}`);

    const excludeProviders = (process.env.EXCLUDE_PROVIDERS ?? "").split(",").filter(Boolean);
    const preferProvider = process.env.PREFER_PROVIDER ?? "";
    const bid = await akashClient.waitForBid(dseq, 90_000, 5_000, excludeProviders, preferProvider);
    await akashClient.createLease(manifest, dseq, bid.id.gseq, bid.id.oseq, bid.id.provider);
    console.log(`[deploy] Lease created with provider=${bid.id.provider}`);

    const providerUrl = await akashClient.waitForServiceUri(dseq);
    console.log(`[deploy] Preview live at: ${previewUrl}`);

    patchRecord(repo, prNumber, {
      phase: "live",
      dseq,
      gseq: bid.id.gseq,
      oseq: bid.id.oseq,
      provider: bid.id.provider,
      providerUrl,
    });

    return { dseq, previewUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[deploy] Failed for ${repo} PR #${prNumber}: ${msg}`);
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
  if (!record) {
    console.log(`[teardown] No active preview for ${repo} PR #${prNumber}`);
    return;
  }

  if (record.dseq) {
    console.log(`[teardown] Closing deployment dseq=${record.dseq}`);
    await akashClient.closeDeployment(record.dseq);
  }
  deleteRecord(repo, prNumber);
  console.log(`[teardown] Done`);
}
