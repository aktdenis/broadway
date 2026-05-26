import { NextResponse } from "next/server";
import { allRecords } from "@/lib/deploy/store";
import { AkashConsoleClient } from "@/lib/akash/client";
import { deployPreview } from "@/lib/deploy/orchestrator";

export async function GET() {
  const records = allRecords();

  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) return NextResponse.json(records);

  const client = new AkashConsoleClient(apiKey);

  const enriched = await Promise.all(
    records.map(async (r) => {
      try {
        const info = await client.getDeployment(r.dseq);
        const lease = info.leases[0];
        const status = lease?.state ?? "unknown";
        const costUdenom =
          lease?.price ? parseFloat(lease.price.amount) : 0;
        // uusd → USD: 1 uusd = 0.000001 USD; monthly ≈ cost per block * blocks/month
        // Akash blocks ~6s, ~432000 blocks/month
        const monthlyUsd = (costUdenom * 432_000) / 1_000_000;
        return { ...r, status, monthlyUsd: +monthlyUsd.toFixed(4) };
      } catch {
        // Fall back to values cached in the store (used for fixtures / offline)
        return { ...r, status: r.status ?? "unknown", monthlyUsd: r.monthlyUsd ?? 0 };
      }
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const { prUrl } = await req.json();

  const match = (prUrl ?? "").match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) {
    return NextResponse.json({ error: "Invalid GitHub PR URL" }, { status: 400 });
  }

  const repo = match[1];
  const prNumber = parseInt(match[2], 10);

  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AKASH_API_KEY not set" }, { status: 500 });
  }

  const akashClient = new AkashConsoleClient(apiKey);

  // Fire-and-forget — deployment takes 2-3 min, client polls /api/previews
  deployPreview({ repo, prNumber, akashClient }).catch(console.error);

  return NextResponse.json({ accepted: true, repo, prNumber });
}
