// Lightweight guard for the mutating preview endpoints. Viewing previews and
// the deployed pr-N.akash.world sites stay public; only create/teardown need
// the token.

export const ALLOWED_REPO = "akash-network/website";
export const ALLOWED_FORK = process.env.ALLOWED_FORK ?? "aktdenis/akash-network-website";

/** True if the request carries the deploy token, or auth is disabled (token unset). */
export function authorized(req: Request): boolean {
  const expected = process.env.DEPLOY_TOKEN;
  if (!expected) return true; // disabled in local dev where no token is set
  return req.headers.get("x-deploy-token") === expected;
}

/** Max number of active (non-failed) previews allowed at once. */
export function previewCap(): number {
  const n = parseInt(process.env.MAX_PREVIEWS ?? "8", 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
}
