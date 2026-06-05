import { NextResponse } from "next/server";
import { AkashConsoleClient } from "@/lib/akash/client";
import { deleteRecord, allRecords } from "@/lib/deploy/store";
import { deletePreviewFiles } from "@/lib/deploy/file-store";
import { authorized } from "@/lib/auth";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ dseq: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Wrong or missing deploy password" }, { status: 401 });
  }

  const { dseq } = await params;
  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AKASH_API_KEY not set" }, { status: 500 });
  }

  const client = new AkashConsoleClient(apiKey);

  // Accept: slug ("pr-1233", "branch-my-feature"), real dseq, or bare PR number
  const record = allRecords().find(
    (r) =>
      r.slug === dseq ||
      r.dseq === dseq ||
      `pr-${r.prNumber}` === dseq ||
      (r.prNumber !== 0 && String(r.prNumber) === dseq)
  );

  // Close Akash deployment if this was a container-based preview
  const toClose = record?.dseq ?? (/^\d{10,}$/.test(dseq) ? dseq : undefined);
  if (toClose) {
    try { await client.closeDeployment(toClose); } catch { /* already closed */ }
  }

  // Delete static files from disk
  if (record?.slug) deletePreviewFiles(record.slug);
  else if (record?.prNumber) deletePreviewFiles(`pr-${record.prNumber}`);

  if (record) deleteRecord(record.slug ?? `pr-${record.prNumber}`);

  return NextResponse.json({ success: true });
}
