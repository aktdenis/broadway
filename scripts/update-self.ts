#!/usr/bin/env ts-node
// Updates the running Broadway deployment in place with a new image — the
// Akash lease, provider, and URL stay the same, so no Cloudflare changes are
// needed. Usage: BROADWAY_IMAGE=ghcr.io/aktdenis/broadway:<sha> update-self.ts <dseq>
import fs from "fs";
import path from "path";
import { AkashConsoleClient } from "../src/akash/client";

const SDL_PATH = path.join(__dirname, "../broadway.sdl.yaml");

async function main() {
  const dseq = process.argv[2];
  if (!dseq) {
    console.error("usage: update-self.ts <dseq>");
    process.exit(1);
  }

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
    .replace("- EXCLUDE_PROVIDERS=", `- EXCLUDE_PROVIDERS=${process.env.EXCLUDE_PROVIDERS ?? ""}`)
    .replace("- PREFER_PROVIDER=", `- PREFER_PROVIDER=${process.env.PREFER_PROVIDER ?? ""}`);

  const client = new AkashConsoleClient(apiKey!);

  console.log(`Updating dseq ${dseq} → ${broadwayImage}`);
  await client.updateDeployment(dseq, sdl);
  console.log("✓ Update submitted. Provider is rolling out the new image.");
  console.log("  The public URL is unchanged; verify broadway.akash.world in ~1-2 min.");
}

main().catch((err) => {
  console.error("\nUpdate failed:", err.response?.data ?? err.message);
  process.exit(1);
});
