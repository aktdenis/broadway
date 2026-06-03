import { NextRequest, NextResponse } from "next/server";
import { getRecord } from "@/lib/deploy/store";
import { AkashConsoleClient } from "@/lib/akash/client";
import { retryDeploy } from "@/lib/deploy/orchestrator";
import { authorized, ALLOWED_REPO } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pr: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Wrong or missing deploy password" }, { status: 401 });
  }

  const { pr } = await params;
  const prNumber = parseInt(pr, 10);
  if (isNaN(prNumber)) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  const record = getRecord(ALLOWED_REPO, prNumber);
  if (!record) {
    return NextResponse.json({ error: "PR not found" }, { status: 404 });
  }
  if (!record.imageRef) {
    return NextResponse.json(
      { error: "No successful build for this PR. Run a full deploy first." },
      { status: 409 }
    );
  }

  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AKASH_API_KEY not set" }, { status: 500 });
  }

  const akashClient = new AkashConsoleClient(apiKey);

  // Fire-and-forget — client polls /api/previews for status.
  retryDeploy({ repo: ALLOWED_REPO, prNumber, akashClient }).catch(console.error);

  return NextResponse.json({ accepted: true, prNumber, imageRef: record.imageRef });
}
