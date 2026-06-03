#!/usr/bin/env ts-node
/**
 * Deploys Broadway from scratch — use when storage resources need to change
 * (Akash does not allow in-place storage updates).
 *
 * Usage:
 *   BROADWAY_IMAGE=ghcr.io/aktdenis/broadway:<sha> npx ts-node scripts/fresh-deploy.ts [old-dseq]
 *
 * If old-dseq is supplied, the old deployment is closed after the new one is live.
 * Prints the new Akash ingress URL at the end — update the Cloudflare Worker with it.
 */

import fs from "fs";
import path from "path";
import { AkashConsoleClient } from "../src/akash/client";

const SDL_PATH = path.join(__dirname, "../broadway.sdl.yaml");
const BOOGLE_CLOUD = "akash1k94uya5rhrtj9rfw850az9aq2d6vdpjmtnlgd0";

async function main() {
  const oldDseq = process.argv[2];

  const apiKey       = process.env.AKASH_API_KEY!;
  const githubToken  = process.env.GITHUB_TOKEN!;
  const webhookSecret = process.env.WEBHOOK_SECRET!;
  const broadwayImage = process.env.BROADWAY_IMAGE!;

  const missing = [
    !apiKey         && "AKASH_API_KEY",
    !githubToken    && "GITHUB_TOKEN",
    !webhookSecret  && "WEBHOOK_SECRET",
    !broadwayImage  && "BROADWAY_IMAGE",
  ].filter(Boolean);
  if (missing.length) {
    console.error("Missing env vars:", missing.join(", "));
    process.exit(1);
  }

  const rawSdl = fs.readFileSync(SDL_PATH, "utf8");
  const sdl = rawSdl
    .replace("image: ghcr.io/aktdenis/broadway:latest", `image: ${broadwayImage}`)
    .replace("- AKASH_API_KEY=",       `- AKASH_API_KEY=${apiKey}`)
    .replace("- GITHUB_TOKEN=",        `- GITHUB_TOKEN=${githubToken}`)
    .replace("- WEBHOOK_SECRET=",      `- WEBHOOK_SECRET=${webhookSecret}`)
    .replace("- DEPLOY_TOKEN=",        `- DEPLOY_TOKEN=${process.env.DEPLOY_TOKEN ?? ""}`)
    .replace("- EXCLUDE_PROVIDERS=",   `- EXCLUDE_PROVIDERS=${process.env.EXCLUDE_PROVIDERS ?? ""}`)
    .replace("- PREFER_PROVIDER=",     `- PREFER_PROVIDER=${process.env.PREFER_PROVIDER ?? ""}`)
    .replace("- PREVIEWS_ROOT=/data/previews", "- PREVIEWS_ROOT=/data/previews");

  const client = new AkashConsoleClient(apiKey);

  // 1. Create deployment.
  console.log("Creating Broadway deployment…");
  const { dseq, manifest } = await client.createDeployment(sdl, 5.0);
  console.log(`  dseq=${dseq}`);

  // 2. Wait for bid.
  console.log("Waiting for bids…");
  const bid = await client.waitForBid(dseq, 120_000, 5_000);
  console.log(`  Provider: ${bid.id.provider}`);

  // 3. Create lease.
  await client.createLease(manifest, dseq, bid.id.gseq, bid.id.oseq, bid.id.provider);
  console.log("Lease created.");

  // 4. Wait for service URI.
  console.log("Waiting for service URI (container start)…");
  const uri = await client.waitForServiceUri(dseq, "broadway", 180_000);
  console.log(`\n✓ Broadway is live at: ${uri}`);
  console.log(`  dseq: ${dseq}`);
  console.log(`\n⚠️  Update the Cloudflare Worker: AKASH_HOST = "${uri.replace(/^https?:\/\//, "")}"`);

  // 5. Close old deployment if provided.
  if (oldDseq) {
    try {
      await client.closeDeployment(oldDseq);
      console.log(`\nClosed old deployment dseq=${oldDseq}`);
    } catch (e) {
      console.warn(`Could not close old deployment ${oldDseq}:`, e);
    }
  }
}

main().catch((err) => {
  console.error("\nDeploy failed:", err.response?.data ?? err.message);
  process.exit(1);
});
