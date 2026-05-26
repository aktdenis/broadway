import express, { Request, Response } from "express";
import crypto from "crypto";
import { Octokit } from "@octokit/rest";
import { AkashConsoleClient } from "./akash/client";
import { GitHubHandler } from "./github/handler";
import { allRecords } from "./deploy/store";

export function createServer(
  akashApiKey: string,
  githubToken: string,
  webhookSecret: string
): express.Application {
  const app = express();

  const akashClient = new AkashConsoleClient(akashApiKey);
  const octokit = new Octokit({ auth: githubToken });
  const ghHandler = new GitHubHandler(octokit, akashClient, webhookSecret);

  app.use(express.json({ verify: rawBodySaver }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/previews", (_req, res) => {
    res.json(allRecords());
  });

  app.post("/webhook/github", async (req: Request, res: Response) => {
    if (!verifySignature(webhookSecret, req)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const event = req.headers["x-github-event"];
    if (event !== "pull_request") {
      res.json({ ignored: true, event });
      return;
    }

    // Respond immediately — GitHub expects <10s
    res.json({ accepted: true });

    setImmediate(async () => {
      try {
        await ghHandler.handlePullRequest(req.body);
      } catch (err) {
        console.error("[webhook] Unhandled error:", err);
      }
    });
  });

  return app;
}

function rawBodySaver(
  req: Request & { rawBody?: Buffer },
  _res: Response,
  buf: Buffer
): void {
  req.rawBody = buf;
}

function verifySignature(
  secret: string,
  req: Request & { rawBody?: Buffer }
): boolean {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
