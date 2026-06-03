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

  // The Cloudflare Worker prepends /api/preview-proxy/{pr}/ to every request path.
  // If the browser URL somehow becomes pr-N.akash.world/api/preview-proxy/N
  // (e.g. Astro view-transitions picks up the Worker-forwarded redirect URL),
  // the Worker double-prefixes the next request:
  //   pr-N.akash.world/api/preview-proxy/N  →  /api/preview-proxy/N/api/preview-proxy/N
  // Detect and strip the inner prefix so the preview still serves correctly.
  let realSegments = segments;
  if (
    segments &&
    segments.length >= 3 &&
    segments[0] === "api" &&
    segments[1] === "preview-proxy" &&
    segments[2] === pr
  ) {
    realSegments = segments.slice(3); // e.g. [] for root, ["docs"] for /docs
  }

  const suffix = realSegments?.join("/") ?? "";
  const target = `${record.providerUrl}/${suffix}${request.nextUrl.search}`;

  try {
    const upstream = await fetch(target, {
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "follow",
      // Fail fast so hairpin-NAT hangs don't hold up the request for 100s.
      signal: AbortSignal.timeout(15_000),
    });

    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    return new NextResponse(body, { status: upstream.status, headers });
  } catch {
    // Proxy failed (most likely hairpin NAT: preview and Broadway are on the
    // same Akash provider, so the ingress can't route the request back to
    // itself). Return a 307 redirect to the raw provider URL. The Cloudflare
    // Worker uses redirect:"follow" and will re-fetch the URL from outside the
    // Akash network where it is reachable, then stream the result to the browser.
    return NextResponse.redirect(target, 307);
  }
}
