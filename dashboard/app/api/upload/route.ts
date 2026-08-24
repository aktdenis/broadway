import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { authorized } from "@/lib/auth";
import { branchToSlug, upsertRecord } from "@/lib/deploy/store";
import { previewDir } from "@/lib/deploy/file-store";

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const name = (formData.get("slug") as string | null)?.trim();

  if (!file || !name) {
    return NextResponse.json({ error: "Missing file or slug" }, { status: 400 });
  }

  const slugName = branchToSlug(name);
  if (!slugName) {
    return NextResponse.json({ error: "Invalid slug — use letters, numbers, hyphens" }, { status: 400 });
  }

  const slug = `branch-${slugName}`;
  const outDir = previewDir(slug);
  const tmpZip = `/tmp/upload-${slug}-${Date.now()}.zip`;

  try {
    writeFileSync(tmpZip, Buffer.from(await file.arrayBuffer()));
    mkdirSync(outDir, { recursive: true });
    execSync(`unzip -o "${tmpZip}" -d "${outDir}"`, { stdio: "pipe" });
  } catch (err) {
    return NextResponse.json({ error: `Extraction failed: ${(err as Error).message}` }, { status: 500 });
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
