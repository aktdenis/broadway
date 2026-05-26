"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, GitBranch, RefreshCw, ServerOff } from "lucide-react";

interface Preview {
  repo: string;
  prNumber: number;
  dseq: string;
  gseq: number;
  oseq: number;
  provider: string;
  previewUrl: string;
  createdAt: string;
  status?: string;
  monthlyUsd?: number;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "unknown") {
    return <Badge variant="outline">unknown</Badge>;
  }
  if (status === "active") {
    return (
      <Badge className="bg-black text-white hover:bg-black border-0">live</Badge>
    );
  }
  if (status === "deploying" || status === "pending") {
    return (
      <Badge variant="outline" className="text-muted-foreground animate-pulse">
        deploying
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function PreviewTable() {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, startRefresh] = useTransition();

  async function load() {
    try {
      const res = await fetch("/api/previews");
      const data: Preview[] = await res.json();
      setPreviews(data);
    } catch {
      // keep stale data
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
        Loading deployments…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm">
          <span>
            <span className="font-semibold tabular-nums">{previews.length}</span>
            <span className="text-muted-foreground ml-1">
              {previews.length === 1 ? "preview" : "previews"} active
            </span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startRefresh(load)}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {previews.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">PR</TableHead>
                <TableHead>Repo / Branch</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Preview URL</TableHead>
                <TableHead className="w-[90px] text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previews.map((p) => (
                <TableRow key={p.dseq}>
                  <TableCell className="font-mono font-medium">
                    #{p.prNumber}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{p.repo}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <GitBranch className="w-3 h-3" />
                      pr-{p.prNumber}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <a
                      href={p.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm font-mono truncate hover:underline underline-offset-4 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {p.previewUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                    {timeAgo(p.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed">
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <ServerOff className="w-10 h-10 text-muted-foreground mb-4" strokeWidth={1.25} />
        <p className="text-sm font-medium mb-1">No active previews</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Open or sync a pull request on{" "}
          <span className="font-mono">akash-network/website</span> to
          automatically deploy a preview on Akash Network.
        </p>
      </div>
    </div>
  );
}
