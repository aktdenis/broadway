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
          - size: 1Gi
  placement:
    dcloud:
      pricing:
        preview:
          denom: uusd
          amount: 500

deployment:
  preview:
    dcloud:
      profile: preview
      count: 1
`;
}

/**
 * Returns the Docker image ref for a given PR number.
 * Matches what the GitHub Actions workflow pushes to ghcr.io.
 */
export function prImageRef(repo: string, prNumber: number): string {
  const [org, name] = repo.toLowerCase().split("/");
  return `ghcr.io/${org}/${name}:pr-${prNumber}`;
}
