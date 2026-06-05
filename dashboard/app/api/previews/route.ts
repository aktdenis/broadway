import { NextResponse } from "next/server";
import { allRecords, branchToSlug } from "@/lib/deploy/store";
import { AkashConsoleClient } from "@/lib/akash/client";
import { deployPreview, deployBranch } from "@/lib/deploy/orchestrator";
import { authorized, ALLOWED_REPO, ALLOWED_FORK, previewCap } from "@/lib/auth";

export async function GET() {
  const records = allRecords();

  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) return NextResponse.json(records);

  const client = new AkashConsoleClient(apiKey);

  const enriched = await Promise.all(
    records.map(async (r) => {
      if (r.phase !== "live" || !r.dseq) return r;
      try {
        const info = await client.getDeployment(r.dseq);
        const lease = info.leases[0];
        const status = lease?.state ?? "unknown";
        const costUdenom = lease?.price ? parseFloat(lease.price.amount) : 0;
        const monthlyUsd = (costUdenom * 432_000) / 1_000_000;
        return { ...r, status, monthlyUsd: +monthlyUsd.toFixed(4) };
      } catch {
        return { ...r, status: r.status ?? "unknown", monthlyUsd: r.monthlyUsd ?? 0 };
      }
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Wrong or missing deploy password" }, { status: 401 });
  }

  const body = await req.json();
  const url: string = body.prUrl ?? body.branchUrl ?? "";

  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AKASH_API_KEY not set" }, { status: 500 });

  const akashClient = new AkashConsoleClient(apiKey);
  const cap = previewCap();
  const active = allRecords().filter((r) => r.phase !== "failed");

  // ── PR deploy: github.com/{org}/{repo}/pull/{N} ───────────────────────────
  const prMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (prMatch) {
    const repo = prMatch[1];
    const prNumber = parseInt(prMatch[2], 10);

    if (repo.toLowerCase() !== ALLOWED_REPO) {
      return NextResponse.json({ error: `Only ${ALLOWED_REPO} PRs are supported` }, { status: 400 });
    }

    const slug = `pr-${prNumber}`;
    const isExisting = active.some((r) => r.slug === slug);
    if (!isExisting && active.length >= cap) {
      return NextResponse.json({ error: `Preview limit reached (${cap}). Tear one down first.` }, { status: 429 });
    }

    deployPreview({ repo, prNumber, akashClient }).catch(console.error);
    return NextResponse.json({ accepted: true, slug, previewUrl: `https://${slug}.${process.env.BROADWAY_DOMAIN ?? "akash.world"}` });
  }

  // ── Branch deploy: github.com/{owner}/{repo}/tree/{branch} ───────────────
  const branchMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/tree\/(.+)/);
  if (branchMatch) {
    const branchRepo = branchMatch[1];
    const branchRef = decodeURIComponent(branchMatch[2]);

    if (branchRepo.toLowerCase() !== ALLOWED_FORK) {
      return NextResponse.json(
        { error: `Branch deploys are only supported from ${ALLOWED_FORK}` },
        { status: 400 }
      );
    }

    const slug = `branch-${branchToSlug(branchRef)}`;
    const isExisting = active.some((r) => r.slug === slug);
    if (!isExisting && active.length >= cap) {
      return NextResponse.json({ error: `Preview limit reached (${cap}). Tear one down first.` }, { status: 429 });
    }

    deployBranch({ branchRef, branchRepo, akashClient }).catch(console.error);
    return NextResponse.json({ accepted: true, slug, previewUrl: `https://${slug}.${process.env.BROADWAY_DOMAIN ?? "akash.world"}` });
  }

  return NextResponse.json(
    { error: "Paste a GitHub PR URL (…/pull/N) or a fork branch URL (…/tree/branch-name)" },
    { status: 400 }
  );
}
