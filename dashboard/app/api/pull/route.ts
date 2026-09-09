import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { authorized } from "@/lib/auth";
import { branchToSlug, upsertRecord } from "@/lib/deploy/store";
import { previewDir } from "@/lib/deploy/file-store";

/**
 * Pull a ZIP from a URL and extract it as a preview.
 * Accepts JSON body: { slug: string, url: string }
 * Bypasses nginx body-size limits since the file is fetched server-side.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { slug?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.slug?.trim();
  const url = body.url?.trim();

  if (!name || !url) {
    return NextResponse.json({ error: "Missing slug or url" }, { status: 400 });
  }

  const slugName = branchToSlug(name);
  if (!slugName) {
    return NextResponse.json({ error: "Invalid slug — use letters, numbers, hyphens" }, { status: 400 });
  }

  const slug = `branch-${slugName}`;
  const outDir = previewDir(slug);
  const tmpZip = `/tmp/pull-${slug}-${Date.now()}.zip`;

  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${res.status} ${res.statusText}` }, { status: 502 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(tmpZip, buffer);
    mkdirSync(outDir, { recursive: true });
    execSync(`unzip -o "${tmpZip}" -d "${outDir}"`, { stdio: "pipe" });
  } catch (err) {
    return NextResponse.json({ error: `Pull failed: ${(err as Error).message}` }, { status: 500 });
  } finally {
    try { rmSync(tmpZip); } catch { /* best-effort */ }
  }

  const previewUrl = `https://${slug}.akash.world`;

  upsertRecord({
    slug,
    repo: "local-upload",
    prNumber: 0,
    phase: "live",
    previewUrl,
    sourceType: "branch",
    branchRef: name,
    filesPath: outDir,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ slug, previewUrl });
}
