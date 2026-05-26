import { Octokit } from "@octokit/rest";
import { AkashConsoleClient } from "../akash/client";
import { deployPreview, teardownPreview } from "../deploy/orchestrator";

export interface WebhookPayload {
  action: string;
  number: number;
  pull_request: {
    head: { sha: string; ref: string };
    base: { repo: { full_name: string } };
    html_url: string;
  };
  repository: { full_name: string };
}

export class GitHubHandler {
  constructor(
    private octokit: Octokit,
    private akashClient: AkashConsoleClient,
    private webhookSecret: string
  ) {}

  async handlePullRequest(payload: WebhookPayload): Promise<void> {
    const { action, number: prNumber, repository } = payload;
    const repo = repository.full_name;

    if (action === "opened" || action === "synchronize" || action === "reopened") {
      await this.deploy(repo, prNumber);
    } else if (action === "closed") {
      await this.teardown(repo, prNumber);
    }
  }

  private async deploy(repo: string, prNumber: number): Promise<void> {
    const [owner, repoName] = repo.split("/");

    await this.postComment(
      owner,
      repoName,
      prNumber,
      `⏳ Deploying preview to Akash Network…`
    );

    try {
      const { previewUrl } = await deployPreview({
        repo,
        prNumber,
        akashClient: this.akashClient,
      });

      await this.postComment(
        owner,
        repoName,
        prNumber,
        [
          `✅ **Preview deployed on Akash Network**`,
          ``,
          `🔗 ${previewUrl}`,
          ``,
          `_Preview will be torn down when this PR is closed._`,
        ].join("\n")
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[handler] Deploy failed for ${repo} PR #${prNumber}:`, msg);
      await this.postComment(
        owner,
        repoName,
        prNumber,
        `❌ Preview deployment failed: ${msg}`
      );
    }
  }

  private async teardown(repo: string, prNumber: number): Promise<void> {
    const [owner, repoName] = repo.split("/");
    try {
      await teardownPreview(repo, prNumber, this.akashClient);
      await this.postComment(owner, repoName, prNumber, `🗑️ Preview deployment on Akash has been torn down.`);
    } catch (err) {
      console.error(`[handler] Teardown failed for ${repo} PR #${prNumber}:`, err);
    }
  }

  private async postComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  }
}
