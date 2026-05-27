// Triggers and tracks the PR-preview build that runs in the fork
// (aktdenis/akash-network-website) via workflow_dispatch, and reports the
// resulting image. Plain fetch against the GitHub REST API.

const OWNER = "aktdenis";
const BUILDER_REPO = "akash-network-website";
const WORKFLOW_FILE = "preview-build.yml";
const GH = "https://api.github.com";

export interface RunInfo {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
}

function headers(token: string) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

async function dispatch(prNumber: number, token: string): Promise<void> {
  const res = await fetch(
    `${GH}/repos/${OWNER}/${BUILDER_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ ref: "main", inputs: { pr: String(prNumber) } }),
    }
  );
  if (res.status !== 204) {
    throw new Error(`workflow_dispatch failed: ${res.status} ${await res.text()}`);
  }
}

// workflow_dispatch returns no run id, so locate the run we just triggered by
// finding the newest dispatch run created at/after our dispatch time.
async function findRun(token: string, sinceMs: number): Promise<RunInfo> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${GH}/repos/${OWNER}/${BUILDER_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`,
      { headers: headers(token) }
    );
    const data = await res.json();
    const runs: Array<{ id: number; html_url: string; status: string; conclusion: string | null; created_at: string }> =
      data.workflow_runs ?? [];
    const match = runs
      .filter((r) => new Date(r.created_at).getTime() >= sinceMs - 5_000)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (match) {
      return { id: match.id, htmlUrl: match.html_url, status: match.status, conclusion: match.conclusion };
    }
    await sleep(3_000);
  }
  throw new Error("Build run did not appear within 60s of dispatch");
}

/** Trigger a build and return as soon as the run is registered (exposes run URL). */
export async function startBuild(prNumber: number, token: string): Promise<RunInfo> {
  const since = Date.now();
  await dispatch(prNumber, token);
  return findRun(token, since);
}

/** Poll a run until it completes; throw if it did not succeed. */
export async function awaitBuild(runId: number, token: string, maxWaitMs = 900_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${GH}/repos/${OWNER}/${BUILDER_REPO}/actions/runs/${runId}`, {
      headers: headers(token),
    });
    const r = await res.json();
    if (r.status === "completed") {
      if (r.conclusion !== "success") {
        throw new Error(`Build failed (${r.conclusion}). Logs: ${r.html_url}`);
      }
      return;
    }
    await sleep(10_000);
  }
  throw new Error("Build did not complete within 15 minutes");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
