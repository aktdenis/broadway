#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import { AkashConsoleClient } from "../src/akash/client";

const SDL_PATH = path.join(__dirname, "../broadway.sdl.yaml");
const DOMAIN = "broadway.akash.world";

async function main() {
  const apiKey = process.env.AKASH_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const broadwayImage = process.env.BROADWAY_IMAGE;

  const missing = [
    !apiKey && "AKASH_API_KEY",
    !githubToken && "GITHUB_TOKEN",
    !webhookSecret && "WEBHOOK_SECRET",
    !broadwayImage && "BROADWAY_IMAGE",
  ].filter(Boolean);

  if (missing.length) {
    console.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }

  const rawSdl = fs.readFileSync(SDL_PATH, "utf8");
  const sdl = rawSdl
    .replace("image: ghcr.io/aktdenis/broadway:latest", `image: ${broadwayImage}`)
    .replace("- AKASH_API_KEY=", `- AKASH_API_KEY=${apiKey}`)
    .replace("- GITHUB_TOKEN=", `- GITHUB_TOKEN=${githubToken}`)
    .replace("- WEBHOOK_SECRET=", `- WEBHOOK_SECRET=${webhookSecret}`)
    .replace("- DEPLOY_TOKEN=", `- DEPLOY_TOKEN=${process.env.DEPLOY_TOKEN ?? ""}`)
    .replace("- EXCLUDE_PROVIDERS=", `- EXCLUDE_PROVIDERS=${process.env.EXCLUDE_PROVIDERS ?? ""}`);

  const client = new AkashConsoleClient(apiKey!);

  console.log(`\nDeploying Broadway to Akash Network...`);
  console.log(`Image: ${broadwayImage}\n`);

  const { dseq, manifest } = await client.createDeployment(sdl, 5.0);
  console.log(`✓ Deployment created (dseq: ${dseq})`);

  console.log("  Waiting for provider bids (~30 seconds)...");
  const bid = await client.waitForBid(dseq);
  console.log(`✓ Bid accepted from provider`);

  console.log("  Creating lease...");
  await client.createLease(manifest, dseq, bid.id.gseq, bid.id.oseq, bid.id.provider);
  console.log(`✓ Lease created`);

  console.log("  Waiting for service to start (~2 minutes)...");
  const providerUri = await client.waitForServiceUri(dseq, "broadway");
  // Strip protocol so it can be used as a bare CNAME target
  const cname = providerUri.replace(/^https?:\/\//, "").split("/")[0];

  console.log(`\n✅ Akash deployment is running!\n`);
  console.log(`   Raw provider URL:  ${providerUri}`);
  console.log(`   Deployment ID:     ${dseq}`);
  console.log(`\n────────────────────────────────────────────`);
  console.log(`NEXT STEP — Add these 2 CNAMEs in Cloudflare:`);
  console.log(`\n   Type:    CNAME`);
  console.log(`   Name:    broadway`);
  console.log(`   Target:  ${cname}`);
  console.log(`   Proxy:   ON (orange cloud)`);
  console.log(`\n   Type:    CNAME`);
  console.log(`   Name:    *.broadway`);
  console.log(`   Target:  ${cname}`);
  console.log(`   Proxy:   ON (orange cloud)`);
  console.log(`\nOnce DNS propagates (~1 min with Cloudflare):`);
  console.log(`   Dashboard:   https://${DOMAIN}`);
  console.log(`   Webhook URL: https://${DOMAIN}/api/webhook/github`);
  console.log(`   PR previews: https://pr-{N}.${DOMAIN}`);
  console.log(`────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error("\nDeploy failed:", err.response?.data ?? err.message);
  process.exit(1);
});
