import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Octokit } from "@octokit/rest";
import { AkashConsoleClient } from "@/lib/akash/client";
import { GitHubHandler } from "@/lib/github-handler";

export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET ?? "";
  const body = await req.text();

  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event !== "pull_request") {
    return NextResponse.json({ ignored: true });
  }

  const payload = JSON.parse(body);

  // Respond immediately — async work below
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const akash = new AkashConsoleClient(process.env.AKASH_API_KEY!);
  const handler = new GitHubHandler(octokit, akash, secret);

  // Fire-and-forget (Next.js edge/serverless: use waitUntil if available)
  handler.handlePullRequest(payload).catch(console.error);

  return NextResponse.json({ accepted: true });
}
