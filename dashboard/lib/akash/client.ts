import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://console-api.akash.network";

// --- API shapes (from /v1/doc OpenAPI spec) ---

export interface CreateDeploymentResult {
  dseq: string;
  manifest: string;
  signTx: { code: number; transactionHash: string; rawLog: string };
}

export interface BidItem {
  bid: {
    id: {
      owner: string;
      dseq: string;
      gseq: number;
      oseq: number;
      provider: string;
      bseq: number;
    };
    state: string;
    price: { denom: string; amount: string };
  };
}

export interface LeaseStatus {
  forwarded_ports: Record<string, { port: number; externalPort: number; host?: string }[]>;
  ips: Record<string, { IP: string; Port: number; ExternalPort: number; Protocol: string }[]>;
  services: Record<
    string,
    { name: string; available: number; total: number; uris: string[]; ready_replicas: number }
  >;
}

export interface LeaseItem {
  id: {
    owner: string;
    dseq: string;
    gseq: number;
    oseq: number;
    provider: string;
    bseq: number;
  };
  state: string;
  price: { denom: string; amount: string };
  created_at: string;
  closed_on: string;
  status: LeaseStatus | null;
}

export interface DeploymentInfo {
  deployment: {
    id: { owner: string; dseq: string };
    state: string;
    hash: string;
    created_at: string;
  };
  leases: LeaseItem[];
}

// -----------------------------------------------

export class AkashConsoleClient {
  private http: AxiosInstance;

  constructor(apiKey: string) {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  }

  async createDeployment(sdl: string, depositUsd: number): Promise<CreateDeploymentResult> {
    const res = await this.http.post<{ data: CreateDeploymentResult }>("/v1/deployments", {
      data: { sdl, deposit: depositUsd },
    });
    return res.data.data;
  }

  async getDeployment(dseq: string): Promise<DeploymentInfo> {
    const res = await this.http.get<{ data: DeploymentInfo }>(`/v1/deployments/${dseq}`);
    return res.data.data;
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    const res = await this.http.get<{ data: { deployments: DeploymentInfo[] } }>("/v1/deployments");
    return res.data.data.deployments ?? [];
  }

  /** dseq is a string; manifest comes from createDeployment response. */
  async createLease(
    manifest: string,
    dseq: string,
    gseq: number,
    oseq: number,
    provider: string
  ): Promise<DeploymentInfo> {
    const res = await this.http.post<{ data: DeploymentInfo }>("/v1/leases", {
      manifest,
      leases: [{ dseq, gseq, oseq, provider }],
    });
    return res.data.data;
  }

  /** Close a deployment (reclaims escrow). Uses DELETE, not a /close POST. */
  async closeDeployment(dseq: string): Promise<void> {
    await this.http.delete(`/v1/deployments/${dseq}`);
  }

  async getBids(dseq: string): Promise<BidItem[]> {
    const res = await this.http.get<{ data: BidItem[] }>(`/v1/bids/${dseq}`);
    return res.data.data ?? [];
  }

  async getMe(): Promise<{ id: string; userId: string; email: string }> {
    const res = await this.http.get<{ data: { id: string; userId: string; email: string } }>(
      "/v1/user/me"
    );
    return res.data.data;
  }

  /**
   * Wait up to maxWaitMs for at least one open bid, then return the best one.
   *
   * Selection order:
   *   1. If preferProvider is set and has an open bid → always pick it.
   *   2. Otherwise pick the cheapest bid among non-excluded providers.
   *
   * Preferred provider bids are accepted on the first poll they appear;
   * non-preferred bids wait the full duration so the preferred provider has
   * time to submit a bid before we fall back.
   */
  async waitForBid(
    dseq: string,
    maxWaitMs = 60_000,
    pollMs = 5_000,
    excludeProviders: string[] = [],
    preferProvider = ""
  ): Promise<BidItem["bid"]> {
    const deadline = Date.now() + maxWaitMs;
    let fallbackBid: BidItem["bid"] | null = null;

    while (Date.now() < deadline) {
      const bids = await this.getBids(dseq);
      const open = bids
        .filter((b) => b.bid.state === "open")
        .filter((b) => !excludeProviders.includes(b.bid.id.provider));

      if (preferProvider) {
        const preferred = open.find((b) => b.bid.id.provider === preferProvider);
        if (preferred) return preferred.bid;
      }

      // Keep the cheapest non-preferred bid in case preferred never bids.
      if (open.length > 0) {
        fallbackBid = open.reduce((best, b) =>
          parseFloat(b.bid.price.amount) < parseFloat(best.bid.price.amount) ? b : best
        ).bid;
      }

      await sleep(pollMs);
    }

    // Preferred never appeared — use cheapest fallback if we have one.
    if (fallbackBid) return fallbackBid;
    throw new Error(`No open bids received for dseq ${dseq} within ${maxWaitMs}ms`);
  }

  /**
   * Poll GET /v1/deployments/{dseq} until lease.status.services[serviceName].uris has an entry.
   * serviceName must match the service key in the SDL (default: "preview").
   */
  async waitForServiceUri(
    dseq: string,
    serviceName = "preview",
    maxWaitMs = 120_000,
    pollMs = 8_000
  ): Promise<string> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const info = await this.getDeployment(dseq);
      for (const lease of info.leases) {
        const svc = lease.status?.services?.[serviceName];
        if (svc?.uris && svc.uris.length > 0) {
          const uri = svc.uris[0];
          return uri.startsWith("http") ? uri : `http://${uri}`;
        }
      }
      await sleep(pollMs);
    }
    throw new Error(`Service URI not available for dseq ${dseq} within ${maxWaitMs}ms`);
  }

  /** Returns true if the API key is accepted. */
  async verifyKey(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) return false;
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
