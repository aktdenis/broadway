/**
 * Downloads a GitHub Actions artifact zip and extracts it to a local directory.
 * Used by Broadway to serve preview static files directly from disk, eliminating
 * the need to deploy a separate Akash container per PR.
 */

import { createWriteStream, mkdirSync, rmSync, existsSync } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { execSync } from "child_process";
import path from "path";

const PREVIEWS_ROOT = process.env.PREVIEWS_ROOT ?? "/data/previews";

export function previewDir(prNumber: number): string {
  return path.join(PREVIEWS_ROOT, String(prNumber));
}

/**
 * Download a GitHub artifact zip (requires auth) and extract it into
 * PREVIEWS_ROOT/{prNumber}/. Any existing files for that PR are replaced.
 */
export async function downloadAndExtract(
  artifactUrl: string,
  prNumber: number,
  token: string
): Promise<string> {
  const outDir = previewDir(prNumber);
  const tmpZip = path.join("/tmp", `preview-${prNumber}-${Date.now()}.zip`);

  mkdirSync(outDir, { recursive: true });

  // 1. Stream artifact zip to a temp file (GitHub redirects to a CDN URL).
  const res = await fetch(artifactUrl, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(600_000), // 10 min max
  });

  if (!res.ok) {
    throw new Error(`Failed to download artifact: ${res.status} ${res.statusText}`);
  }

  const writeStream = createWriteStream(tmpZip);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), writeStream);

  // 2. Extract — unzip is installed in the Broadway Dockerfile.
  try {
    execSync(`unzip -o "${tmpZip}" -d "${outDir}"`, { stdio: "pipe" });
  } finally {
    try { rmSync(tmpZip); } catch { /* best-effort cleanup */ }
  }

  console.log(`[file-store] Extracted preview for PR #${prNumber} → ${outDir}`);
  return outDir;
}

/** Remove all files for a PR preview (called on teardown). */
export function deletePreviewFiles(prNumber: number): void {
  const dir = previewDir(prNumber);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[file-store] Deleted preview files for PR #${prNumber}`);
  }
}

/** MIME type lookup for static file serving. */
export function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}
