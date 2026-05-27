import { NextResponse } from "next/server";
import { AkashConsoleClient } from "@/lib/akash/client";
import { deleteRecord, allRecords } from "@/lib/deploy/store";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dseq: string }> }
) {
  const { dseq } = await params;
  const apiKey = process.env.AKASH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AKASH_API_KEY not set" }, { status: 500 });
  }

  const client = new AkashConsoleClient(apiKey);
  // `dseq` param may be a real dseq (live preview) or "pr-<n>" (still building).
  const record = allRecords().find(
    (r) => r.dseq === dseq || `pr-${r.prNumber}` === dseq
  );
  const toClose = record?.dseq ?? (/^\d+$/.test(dseq) ? dseq : undefined);
  if (toClose) {
    try {
      await client.closeDeployment(toClose);
    } catch {
      // deployment may not exist yet; deleting the record is enough
    }
  }
  if (record) deleteRecord(record.repo, record.prNumber);

  return NextResponse.json({ success: true });
}
