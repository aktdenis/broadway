import fs from "fs";
import path from "path";

export type PreviewPhase = "building" | "deploying" | "live" | "failed";

export interface PreviewRecord {
  repo: string;
  prNumber: number;
  phase: PreviewPhase;
  previewUrl: string; // public custom-domain URL, e.g. https://pr-247.akash.world
  createdAt: string;
  buildRunUrl?: string; // link to the GitHub Actions build run
  error?: string; // failure reason when phase === "failed"
  // Populated once the Akash deployment exists (deploying/live):
  dseq?: string;
  gseq?: number;
  oseq?: number;
  provider?: string;
  providerUrl?: string; // raw Akash provider URL, used for proxying
  // Optional cached values — used as fallback when Akash API is unreachable
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

function key(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

export function getRecord(repo: string, prNumber: number): PreviewRecord | undefined {
  return load()[key(repo, prNumber)];
}

export function upsertRecord(record: PreviewRecord): void {
  const data = load();
  data[key(record.repo, record.prNumber)] = record;
  save(data);
}

/** Merge a partial update into an existing record (no-op if it's gone). */
export function patchRecord(repo: string, prNumber: number, patch: Partial<PreviewRecord>): void {
  const data = load();
  const k = key(repo, prNumber);
  if (!data[k]) return;
  data[k] = { ...data[k], ...patch };
  save(data);
}

export function deleteRecord(repo: string, prNumber: number): void {
  const data = load();
  delete data[key(repo, prNumber)];
  save(data);
}

export function allRecords(): PreviewRecord[] {
  return Object.values(load());
}
