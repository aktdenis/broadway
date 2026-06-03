/**
 * Generates an Akash SDL for serving a pre-built Astro static site from a
 * Docker image pushed to ghcr.io (e.g. ghcr.io/akash-network/website:pr-42).
 *
 * The image is expected to be an nginx container serving /usr/share/nginx/html.
 */
export function buildPreviewSdl(imageRef: string): string {
  return `---
version: "2.0"

services:
  preview:
    image: ${imageRef}
    expose:
      - port: 80
        as: 80
        to:
          - global: true

profiles:
  compute:
    preview:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 256Mi
        storage:
          - size: 8Gi
  placement:
    dcloud:
      pricing:
        preview:
          denom: uusd
          amount: 700

deployment:
  preview:
    dcloud:
      profile: preview
      count: 1
`;
}

const PREVIEW_IMAGE = "ghcr.io/aktdenis/website-preview";

/**
 * Returns the Docker image ref for a given PR number. Matches what the fork's
 * preview-build workflow pushes to ghcr.io.
 */
/**
 * Returns the Docker image ref for a given PR number.
 * When runId is supplied we use the run-specific tag (pr-N-{runId}) so
 * each deployment always forces a fresh image pull on the provider — no
 * stale cached layers from a previous failed deployment.
 */
export function prImageRef(prNumber: number, runId?: number): string {
  return runId
    ? `${PREVIEW_IMAGE}:pr-${prNumber}-${runId}`
    : `${PREVIEW_IMAGE}:pr-${prNumber}`;
}
