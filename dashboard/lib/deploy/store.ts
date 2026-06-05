import fs from "fs";
import path from "path";

export type PreviewPhase = "building" | "deploying" | "live" | "failed";

export interface PreviewRecord {
  // ── Identity ────────────────────────────────────────────────────────────────
  repo: string;
  prNumber: number;        // PR number for upstream PRs; synthetic (0) for branch deploys
  slug: string;            // routing key: "pr-1233" | "branch-my-feature"
  phase: PreviewPhase;
  previewUrl: string;      // public URL: https://pr-1233.akash.world or https://branch-slug.akash.world
  createdAt: string;

  // ── Source info ─────────────────────────────────────────────────────────────
  sourceType: "pr" | "branch";
  branchRef?: string;      // branch name for branch-type deploys
  branchRepo?: string;     // fork repo for branch-type deploys, e.g. aktdenis/akash-network-website

  // ── Build ───────────────────────────────────────────────────────────────────
  buildRunUrl?: string;
  imageRef?: string;       // kept for backward compat with old Akash-container previews
  filesPath?: string;      // path on Broadway's disk where static files are extracted

  // ── Error ───────────────────────────────────────────────────────────────────
  error?: string;

  // ── Legacy Akash container fields (backward compat) ─────────────────────────
  dseq?: string;
  gseq?: number;
  oseq?: number;
  provider?: string;
  providerUrl?: string;
  status?: string;
  monthlyUsd?: number;
}

const STORE_PATH = process.env.STORE_PATH ?? path.join(process.cwd(), "deployments.json");

function load(): Record<string, PreviewRecord> {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(data: Record<string, PreviewRecord>): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Primary key is the routing slug — unique across both PRs and branches. */
function key(slug: string): string {
  return slug;
}

export function getRecord(slug: string): PreviewRecord | undefined;
export function getRecord(repo: string, prNumber: number): PreviewRecord | undefined;
export function getRecord(slugOrRepo: string, prNumber?: number): PreviewRecord | undefined {
  const data = load();
  if (prNumber !== undefined) {
    // Legacy call: look up by PR number
    const slug = `pr-${prNumber}`;
    return data[slug] ?? Object.values(data).find(r => r.prNumber === prNumber && r.repo === slugOrRepo);
  }
  return data[key(slugOrRepo)];
}

export function upsertRecord(record: PreviewRecord): void {
  const data = load();
  // Ensure slug is set (migrate old records that may not have it)
  if (!record.slug) record.slug = `pr-${record.prNumber}`;
  data[key(record.slug)] = record;
  save(data);
}

export function patchRecord(slug: string, patch: Partial<PreviewRecord>): void;
export function patchRecord(repo: string, prNumber: number, patch: Partial<PreviewRecord>): void;
export function patchRecord(
  slugOrRepo: string,
  patchOrPrNumber: Partial<PreviewRecord> | number,
  maybePatch?: Partial<PreviewRecord>
): void {
  const data = load();
  let k: string;
  let patch: Partial<PreviewRecord>;

  if (typeof patchOrPrNumber === "number") {
    k = `pr-${patchOrPrNumber}`;
    patch = maybePatch!;
    // Fallback: find by repo+prNumber for old records stored without slug key
    if (!data[k]) {
      const found = Object.entries(data).find(([, r]) => r.prNumber === patchOrPrNumber && r.repo === slugOrRepo);
      if (found) k = found[0];
    }
  } else {
    k = key(slugOrRepo);
    patch = patchOrPrNumber;
  }

  if (!data[k]) return;
  data[k] = { ...data[k], ...patch };
  save(data);
}

export function deleteRecord(slug: string): void;
export function deleteRecord(repo: string, prNumber: number): void;
export function deleteRecord(slugOrRepo: string, prNumber?: number): void {
  const data = load();
  if (prNumber !== undefined) {
    const k = `pr-${prNumber}`;
    delete data[k];
    // Also clean up any stale record keyed differently
    for (const [k2, r] of Object.entries(data)) {
      if (r.prNumber === prNumber && r.repo === slugOrRepo) delete data[k2];
    }
  } else {
    delete data[key(slugOrRepo)];
  }
  save(data);
}

export function allRecords(): PreviewRecord[] {
  return Object.values(load());
}

/** Convert a branch name to a URL-safe slug: "feat/my-feature" → "feat-my-feature" */
export function branchToSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
