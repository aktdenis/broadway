import { createServer } from "./server";
import { AkashConsoleClient } from "./akash/client";

const REQUIRED_ENV = ["AKASH_API_KEY", "GITHUB_TOKEN", "WEBHOOK_SECRET"] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const akashApiKey = process.env.AKASH_API_KEY!;
const githubToken = process.env.GITHUB_TOKEN!;
const webhookSecret = process.env.WEBHOOK_SECRET!;
const port = Number(process.env.PORT ?? 3000);

// Verify Akash API key on startup
const akashClient = new AkashConsoleClient(akashApiKey);
akashClient.verifyKey().then((valid) => {
  if (!valid) {
    console.error("Akash Console API key is invalid (401). Check AKASH_API_KEY.");
    process.exit(1);
  }
  console.log("Akash Console API key verified ✓");
});

const app = createServer(akashApiKey, githubToken, webhookSecret);

app.listen(port, () => {
  console.log(`akash-preview listening on port ${port}`);
  console.log(`  POST /webhook/github  — GitHub PR webhooks`);
  console.log(`  GET  /previews        — active preview list`);
  console.log(`  GET  /health          — health check`);
});
