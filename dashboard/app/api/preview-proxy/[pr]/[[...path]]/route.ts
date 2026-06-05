import { NextRequest, NextResponse } from "next/server";
import { stat, readFile } from "fs/promises";
import path from "path";
import { allRecords } from "@/lib/deploy/store";
import { mimeType } from "@/lib/deploy/file-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pr: string; path?: string[] }> }
) {
  const { pr, path: segments } = await params;
  const records = allRecords();

  // pr param is a slug: "pr-1233", "branch-my-feature", or bare "1233" (old Worker).
  const prNum = pr.startsWith("pr-") ? parseInt(pr.slice(3), 10) : parseInt(pr, 10);
  const record =
    records.find((r) => r.slug === pr) ??
    (!isNaN(prNum) ? records.find((r) => r.prNumber === prNum) : undefined);

  if (!record) {
    return new NextResponse("Preview not found", { status: 404 });
  }

  // ── FILE-BASED (current architecture) ────────────────────────────────────
  if (record.filesPath) {
    return serveFromDisk(record.filesPath, segments ?? [], request);
  }

  // ── CONTAINER-BASED (backward compat) ────────────────────────────────────
  if (!record.providerUrl) {
    return new NextResponse("Preview not ready", { status: 404 });
  }

  let realSegments = segments;
  if (segments && segments.length >= 3 && segments[0] === "api" && segments[1] === "preview-proxy" && segments[2] === pr) {
    realSegments = segments.slice(3);
  }

  const suffix = realSegments?.join("/") ?? "";
  const target = `${record.providerUrl}/${suffix}${request.nextUrl.search}`;

  try {
    const upstream = await fetch(target, {
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    return new NextResponse(body, { status: upstream.status, headers });
  } catch {
    return NextResponse.redirect(target, 307);
  }
}

// ── Async disk file server ────────────────────────────────────────────────────

async function serveFromDisk(
  filesPath: string,
  segments: string[],
  _request: NextRequest
): Promise<NextResponse> {
  const relative = segments.length ? segments.join("/") : "";
  const candidate = path.normalize(path.join(filesPath, relative));

  // Security: never escape the preview directory.
  if (!candidate.startsWith(path.normalize(filesPath))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const resolved = await resolveFile(candidate);
  if (!resolved) {
    const nf = await tryFile(path.join(filesPath, "404.html"));
    if (nf) {
      return new NextResponse(await readFile(nf), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": mimeType(resolved),
  };

  // Hashed assets (_astro/) are immutable — cache at browser and CDN edge.
  // HTML pages must revalidate so content updates are picked up.
  if (resolved.includes("/_astro/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else if (resolved.endsWith(".html")) {
    headers["cache-control"] = "no-cache";
  } else {
    headers["cache-control"] = "public, max-age=3600";
  }

  const content = await readFile(resolved);
  return new NextResponse(content, { headers });
}

async function tryFile(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    return s.isFile() ? p : null;
  } catch {
    return null;
  }
}

async function resolveFile(candidate: string): Promise<string | null> {
  return (
    (await tryFile(candidate)) ??
    (await tryFile(`${candidate}/index.html`)) ??
    (await tryFile(`${candidate}.html`)) ??
    null
  );
}
