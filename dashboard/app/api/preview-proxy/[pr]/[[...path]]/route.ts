import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
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
  // Old store records have prNumber but no slug field — handle all three cases.
  const prNum = pr.startsWith("pr-")
    ? parseInt(pr.slice(3), 10)   // "pr-1233" → 1233
    : parseInt(pr, 10);           // "1233" → 1233 (legacy), "branch-*" → NaN

  const record =
    records.find((r) => r.slug === pr) ??
    (!isNaN(prNum) ? records.find((r) => r.prNumber === prNum) : undefined);

  if (!record) {
    return new NextResponse("Preview not found", { status: 404 });
  }

  // ── FILE-BASED (new architecture) ──────────────────────────────────────────
  // Static files were extracted to Broadway's disk after the build.
  // Serve them directly — no Akash container involved.
  if (record.filesPath) {
    return serveFromDisk(record.filesPath, segments ?? [], request);
  }

  // ── CONTAINER-BASED (old architecture, backward compat) ────────────────────
  if (!record.providerUrl) {
    return new NextResponse("Preview not ready", { status: 404 });
  }

  // Double-prefix guard: Worker adds /api/preview-proxy/N/ to every path.
  // If a redirect loops back, strip the inner prefix.
  let realSegments = segments;
  if (
    segments &&
    segments.length >= 3 &&
    segments[0] === "api" &&
    segments[1] === "preview-proxy" &&
    segments[2] === pr
  ) {
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
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return new NextResponse(body, { status: upstream.status, headers });
  } catch {
    // Hairpin-NAT fallback: redirect so the Cloudflare Worker fetches the
    // provider URL from outside the Akash network.
    return NextResponse.redirect(target, 307);
  }
}

// ── Disk file server ──────────────────────────────────────────────────────────

function serveFromDisk(
  filesPath: string,
  segments: string[],
  request: NextRequest
): NextResponse {
  // Resolve the requested path within the preview directory.
  const relative = segments.length ? segments.join("/") : "";
  let candidate = path.normalize(path.join(filesPath, relative));

  // Security: never escape the preview directory.
  if (!candidate.startsWith(path.normalize(filesPath))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Resolve to a real file using Astro's output conventions:
  //   /            → index.html
  //   /about       → about/index.html  OR  about.html
  //   /about/      → about/index.html
  const resolved = resolveFile(candidate);
  if (!resolved) {
    // Serve the generated 404 page if available.
    const notFoundPage = path.join(filesPath, "404.html");
    const nf = tryFile(notFoundPage);
    if (nf) {
      return new NextResponse(readFileSync(nf), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": mimeType(resolved),
  };

  // Cache-control: HTML never cached; hashed assets cached forever.
  if (resolved.endsWith(".html")) {
    headers["cache-control"] = "no-cache";
  } else if (resolved.includes("/_astro/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  return new NextResponse(readFileSync(resolved), { headers });
}

/** Return the path if it exists AND is a regular file (not a directory). */
function tryFile(p: string): string | null {
  try { return statSync(p).isFile() ? p : null; } catch { return null; }
}

/** Try candidate paths in order; return the first that is a real file. */
function resolveFile(candidate: string): string | null {
  return (
    tryFile(candidate) ??                      // exact file match
    tryFile(`${candidate}/index.html`) ??      // directory → index.html
    tryFile(`${candidate}.html`) ??            // /about → about.html
    null
  );
}
