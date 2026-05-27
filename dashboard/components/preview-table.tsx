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
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  ExternalLink,
  FileText,
  GitBranch,
  Hammer,
  RefreshCw,
  ServerOff,
  Trash2,
} from "lucide-react";

type Phase = "building" | "deploying" | "live" | "failed";

interface Preview {
  repo: string;
  prNumber: number;
  phase: Phase;
  previewUrl: string;
  buildRunUrl?: string;
  error?: string;
  dseq?: string;
  provider?: string;
  createdAt: string;
  status?: string;
  monthlyUsd?: number;
}

const TOKEN_KEY = "broadway_deploy_token";

function PhaseBadge({ p }: { p: Preview }) {
  if (p.phase === "building") {
    return (
      <Badge variant="outline" className="text-muted-foreground animate-pulse gap-1">
        <Hammer className="w-3 h-3" />
        building
      </Badge>
    );
  }
  if (p.phase === "deploying") {
    return (
      <Badge variant="outline" className="text-muted-foreground animate-pulse">
        deploying
      </Badge>
    );
  }
  if (p.phase === "failed") {
    return (
      <Badge variant="outline" className="text-red-500 border-red-200 gap-1">
        <AlertCircle className="w-3 h-3" />
        failed
      </Badge>
    );
  }
  if (p.status && p.status !== "active" && p.status !== "unknown") {
    return <Badge variant="outline">{p.status}</Badge>;
  }
  return <Badge className="bg-black text-white hover:bg-black border-0">live</Badge>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DeployForm({
  token,
  onToken,
  onDeployed,
}: {
  token: string;
  onToken: (t: string) => void;
  onDeployed: () => void;
}) {
  const [prUrl, setPrUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/previews", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-deploy-token": token },
        body: JSON.stringify({ prUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Deployment failed");
      } else {
        setPrUrl("");
        onDeployed();
      }
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="password"
          placeholder="Deploy password"
          value={token}
          onChange={(e) => onToken(e.target.value)}
          className="w-44 text-sm"
          aria-label="Deploy password"
        />
        <Input
          placeholder="https://github.com/akash-network/website/pull/123"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
          disabled={pending}
          className="font-mono text-sm flex-1"
        />
        <Button type="submit" disabled={pending || !prUrl.trim() || !token.trim()}>
          {pending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Deploy"}
        </Button>
      </form>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Builds the PR and deploys it to Akash — usually 8–10 minutes end to end.
        </p>
      )}
    </div>
  );
}

export function PreviewTable() {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  const [tearingDown, setTearingDown] = useState<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  function saveToken(t: string) {
    setToken(t);
    localStorage.setItem(TOKEN_KEY, t);
  }

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
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  async function teardown(id: string) {
    setTearingDown(id);
    try {
      await fetch(`/api/previews/${id}`, {
        method: "DELETE",
        headers: { "x-deploy-token": token },
      });
      await load();
    } finally {
      setTearingDown(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
        Loading deployments…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DeployForm token={token} onToken={saveToken} onDeployed={() => startRefresh(load)} />

      <div className="flex items-center justify-between">
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{previews.length}</span>
          <span className="text-muted-foreground ml-1">
            {previews.length === 1 ? "preview" : "previews"} active
          </span>
        </span>
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
                <TableHead>Repo</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead>Preview URL</TableHead>
                <TableHead className="w-[90px] text-right">Age</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {previews.map((p) => {
                const id = `pr-${p.prNumber}`;
                return (
                  <TableRow key={id}>
                    <TableCell className="font-mono font-medium">#{p.prNumber}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{p.repo}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <GitBranch className="w-3 h-3" />
                        pr-{p.prNumber}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PhaseBadge p={p} />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      {p.phase === "live" ? (
                        <a
                          href={p.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm font-mono truncate hover:underline underline-offset-4 cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          {p.previewUrl.replace(/^https?:\/\//, "")}
                        </a>
                      ) : p.phase === "failed" ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-500 truncate" title={p.error}>
                            {p.error ?? "Build failed"}
                          </span>
                          {p.buildRunUrl && <LogsLink href={p.buildRunUrl} />}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-muted-foreground truncate">
                            {p.previewUrl.replace(/^https?:\/\//, "")}
                          </span>
                          {p.buildRunUrl && <LogsLink href={p.buildRunUrl} />}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {timeAgo(p.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-red-500"
                        disabled={tearingDown === id}
                        onClick={() => teardown(id)}
                        aria-label="Teardown"
                      >
                        {tearingDown === id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LogsLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-muted-foreground hover:underline underline-offset-4 shrink-0"
    >
      <FileText className="w-3 h-3" />
      logs
    </a>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed">
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <ServerOff className="w-10 h-10 text-muted-foreground mb-4" strokeWidth={1.25} />
        <p className="text-sm font-medium mb-1">No active previews</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Enter your deploy password and paste an akash-network/website PR URL to deploy a
          preview on Akash Network.
        </p>
      </div>
    </div>
  );
}
