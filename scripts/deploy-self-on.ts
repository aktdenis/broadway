#!/usr/bin/env ts-node
// Deploys Broadway, preferring a specific provider and excluding known-bad
// ones. PREFER_PROVIDER and EXCLUDE_PROVIDERS (comma-separated) are addresses.
import fs from "fs";
import path from "path";
import { AkashConsoleClient } from "../src/akash/client";

const SDL_PATH = path.join(__dirname, "../broadway.sdl.yaml");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pickBid(client: AkashConsoleClient, dseq: string) {
  const prefer = process.env.PREFER_PROVIDER;
  const exclude = (process.env.EXCLUDE_PROVIDERS ?? "").split(",").filter(Boolean);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const bids = (await client.getBids(dseq)).filter((b) => b.bid.state === "open");
    const usable = bids.filter((b) => !exclude.includes(b.bid.id.provider));
    const preferred = usable.find((b) => b.bid.id.provider === prefer);
    if (preferred) return preferred.bid;
    if (usable.length > 0 && Date.now() - (deadline - 90_000) > 25_000) {
      // after ~25s, if preferred hasn't shown, take cheapest usable
      return usable.reduce((best, b) =>
        parseFloat(b.bid.price.amount) < parseFloat(best.bid.price.amount) ? b : best
      ).bid;
    }
    await sleep(5_000);
  }
  throw new Error("No usable bid found");
}

async function main() {
  const apiKey = process.env.AKASH_API_KEY!;
  const githubToken = process.env.GITHUB_TOKEN!;
  const webhookSecret = process.env.WEBHOOK_SECRET!;
  const broadwayImage = process.env.BROADWAY_IMAGE!;
  for (const [k, v] of Object.entries({ apiKey, githubToken, webhookSecret, broadwayImage })) {
    if (!v) {
      console.error(`Missing ${k}`);
      process.exit(1);
    }
  }

  const sdl = fs
    .readFileSync(SDL_PATH, "utf8")
    .replace("image: ghcr.io/aktdenis/broadway:latest", `image: ${broadwayImage}`)
    .replace("- AKASH_API_KEY=", `- AKASH_API_KEY=${apiKey}`)
    .replace("- GITHUB_TOKEN=", `- GITHUB_TOKEN=${githubToken}`)
    .replace("- WEBHOOK_SECRET=", `- WEBHOOK_SECRET=${webhookSecret}`)
    .replace("- DEPLOY_TOKEN=", `- DEPLOY_TOKEN=${process.env.DEPLOY_TOKEN ?? ""}`)
    .replace("- EXCLUDE_PROVIDERS=", `- EXCLUDE_PROVIDERS=${process.env.EXCLUDE_PROVIDERS ?? ""}`);

  const client = new AkashConsoleClient(apiKey);
  console.log(`Deploying Broadway (image ${broadwayImage})…`);
  const { dseq, manifest } = await client.createDeployment(sdl, 5.0);
  console.log(`✓ dseq ${dseq}; waiting for bids…`);

  const bid = await pickBid(client, dseq);
  console.log(`✓ Selected provider ${bid.id.provider} @ ${bid.price.amount}`);

  // The Console API sometimes throws a transient "no lease" right after the
  // lease is actually created, so verify by polling rather than trusting it.
  try {
    await client.createLease(manifest, dseq, bid.id.gseq, bid.id.oseq, bid.id.provider);
  } catch (e) {
    console.log("  createLease returned an error; verifying lease state…");
  }
  console.log("  Waiting for service URI…");
  const uri = await client.waitForServiceUri(dseq, "broadway", 180_000);
  const cname = uri.replace(/^https?:\/\//, "").split("/")[0];

  console.log(`\n✅ New Broadway running`);
  console.log(`   dseq:  ${dseq}`);
  console.log(`   CNAME: ${cname}`);
}

main().catch((err) => {
  console.error("\nDeploy failed:", err.response?.data ?? err.message);
  process.exit(1);
});
