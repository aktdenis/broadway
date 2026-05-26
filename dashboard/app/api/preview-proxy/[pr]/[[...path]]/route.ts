import { NextRequest, NextResponse } from "next/server";
import { allRecords } from "@/lib/deploy/store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pr: string; path?: string[] }> }
) {
  const { pr, path: segments } = await params;
  const records = allRecords();
  const record = records.find((r) => r.prNumber === parseInt(pr, 10));

  if (!record?.providerUrl) {
    return new NextResponse("Preview not found", { status: 404 });
  }

  const suffix = segments?.join("/") ?? "";
  const target = `${record.providerUrl}/${suffix}${request.nextUrl.search}`;

  try {
    const upstream = await fetch(target, {
      headers: { accept: request.headers.get("accept") ?? "*/*" },
    });

    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    return new NextResponse(body, { status: upstream.status, headers });
  } catch {
    return new NextResponse("Preview unavailable", { status: 502 });
  }
}
