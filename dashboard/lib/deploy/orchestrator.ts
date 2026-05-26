import { AkashConsoleClient } from "@/lib/akash/client";
import { buildPreviewSdl, prImageRef } from "@/lib/akash/sdl";
import { upsertRecord, deleteRecord, getRecord } from "@/lib/deploy/store";

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
  const imageRef = prImageRef(repo, prNumber);
  const sdl = buildPreviewSdl(imageRef);

  console.log(`[deploy] Creating deployment for ${repo} PR #${prNumber} (image: ${imageRef})`);

  const { dseq, manifest } = await akashClient.createDeployment(sdl, depositUsd);
  console.log(`[deploy] Deployment created: dseq=${dseq}`);

  console.log(`[deploy] Waiting for bids on dseq=${dseq}…`);
  const bid = await akashClient.waitForBid(dseq);
  console.log(`[deploy] Accepted bid from provider=${bid.id.provider} price=${bid.price.amount}${bid.price.denom}`);

  await akashClient.createLease(manifest, dseq, bid.id.gseq, bid.id.oseq, bid.id.provider);
  console.log(`[deploy] Lease created`);

  console.log(`[deploy] Waiting for service URI…`);
  const providerUrl = await akashClient.waitForServiceUri(dseq);
  const domain = process.env.BROADWAY_DOMAIN ?? "broadway.akash.world";
  const previewUrl = `https://pr-${prNumber}.${domain}`;
  console.log(`[deploy] Preview live at: ${previewUrl}`);

  upsertRecord({
    repo,
    prNumber,
    dseq,
    gseq: bid.id.gseq,
    oseq: bid.id.oseq,
    provider: bid.id.provider,
    providerUrl,
    previewUrl,
    createdAt: new Date().toISOString(),
  });

  return { dseq, previewUrl };
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

  console.log(`[teardown] Closing deployment dseq=${record.dseq}`);
  await akashClient.closeDeployment(record.dseq);
  deleteRecord(repo, prNumber);
  console.log(`[teardown] Done`);
}
