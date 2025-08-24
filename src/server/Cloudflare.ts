import { spawn } from "child_process";
import { promises as fs } from "fs";
import yaml from "js-yaml";
import { z } from "zod";
import { logger } from "./Logger";

const log = logger.child({
  module: "cloudflare",
});

export type TunnelConfig = {
  domain: string;
  subdomain: string;
  subdomainToService: Map<string, string>;
};

type TunnelResponse = {
  result: {
    id: string;
    token: string;
  };
};

type ZoneResponse = {
  result: Array<{
    id: string;
  }>;
};

type DNSRecordResponse = {
  result: Array<{
    id: string;
  }>;
};

type CloudflaredConfig = {
  tunnel: string;
  "credentials-file": string;
  ingress: Array<{
    hostname?: string;
    service: string;
  }>;
};

const CloudflareTunnelConfigSchema = z.object({
  a: z.string(),
  s: z.string(),
  t: z.string(),
});

export class Cloudflare {
  private readonly baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly configPath: string,
    private readonly credsPath: string,
  ) {
    log.info(`Using config: ${this.configPath}`);
    log.info(`Using credentials: ${this.credsPath}`);
  }

  private async makeRequest<T>(
    url: string,
    method = "GET",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any,
  ): Promise<T> {
    const response = await fetch(url, {
      body: data ? JSON.stringify(data) : undefined,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      method,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare API error: url ${url} ${response.status} - ${errorText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  public async configAlreadyExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  public async createTunnel(config: TunnelConfig): Promise<{
    tunnelId: string;
    tunnelToken: string;
    tunnelUrl: string;
  }> {
    const { domain, subdomain, subdomainToService } = config;

    // Generate unique tunnel name
    const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
    const tunnelName = `${subdomain}-tunnel-${timestamp}`;

    log.info(`Creating tunnel with name: ${tunnelName}`);

    // Create tunnel via API to get official tunnel ID and token
    const tunnelResponse = await this.makeRequest<TunnelResponse>(
      `${this.baseUrl}/accounts/${this.accountId}/cfd_tunnel`,
      "POST",
      { name: tunnelName },
    );

    const tunnelId = tunnelResponse.result.id;
    const tunnelToken = tunnelResponse.result.token;

    if (!tunnelId) {
      throw new Error("Failed to create tunnel");
    }

    log.info(`Tunnel created with ID: ${tunnelId}`);

    // Create local config file instead of using API configuration
    await this.writeTunnelConfig(
      tunnelId,
      tunnelToken,
      subdomain,
      domain,
      subdomainToService,
      tunnelName,
    );

    // Get zone ID
    const zoneResponse = await this.makeRequest<ZoneResponse>(
      `${this.baseUrl}/zones?name=${domain}`,
    );

    const zoneId = zoneResponse.result[0]?.id;
    if (!zoneId) {
      throw new Error(`Could not find zone ID for domain ${domain}`);
    }

    await Promise.all(
      Array.from(subdomainToService.entries()).map(([subdomain, _]) =>
        this.updateDNSRecord(zoneId, tunnelId, subdomain, domain),
      ),
    );

    const tunnelUrl = `https://${subdomain}.${domain}`;
    log.info(`Tunnel is set up! Site will be available at: ${tunnelUrl}`);

    return { tunnelId, tunnelToken, tunnelUrl };
  }

  private async writeTunnelConfig(
    tunnelId: string,
    tunnelToken: string,
    subdomain: string,
    domain: string,
    subdomainToService: Map<string, string>,
    tunnelName: string,
  ): Promise<void> {
    log.info(`Creating local config for tunnel ${subdomain}.${domain}...`);
    const tokenData = CloudflareTunnelConfigSchema.parse(
      JSON.parse(Buffer.from(tunnelToken, "base64").toString("utf8")),
    );

    const credentials = {
      AccountTag: tokenData.a || this.accountId,
      TunnelID: tokenData.t || tunnelId,
      TunnelName: tunnelName,
      TunnelSecret: tokenData.s,
    };

    await fs.writeFile(
      this.credsPath,
      JSON.stringify(credentials, null, 2),
      "utf8",
    );
    log.info(`Created credentials file at: ${this.credsPath}`);

    const tunnelConfig: CloudflaredConfig = {
      "credentials-file": this.credsPath,
      ingress: [
        ...Array.from(subdomainToService.entries()).map(
          ([subdomain, service]) => ({
            hostname: `${subdomain}.${domain}`,
            service,
          }),
        ),
        {
          service: "http_status:404",
        },
      ],
      tunnel: tunnelId,
    };

    // Write config file
    await fs.writeFile(this.configPath, yaml.dump(tunnelConfig), "utf8");
    log.info(`Created config file at: ${this.configPath}`);
  }

  private async updateDNSRecord(
    zoneId: string,
    tunnelId: string,
    subdomain: string,
    domain: string,
  ): Promise<void> {
    const existingRecords = await this.makeRequest<DNSRecordResponse>(
      `${this.baseUrl}/zones/${zoneId}/dns_records?name=${subdomain}.${domain}`,
    );

    const recordId = existingRecords.result[0]?.id;
    const dnsData = {
      content: `${tunnelId}.cfargotunnel.com`,
      name: subdomain,
      proxied: true,
      ttl: 1,
      type: "CNAME",
    };

    if (recordId) {
      log.info(`Updating existing DNS record for ${subdomain}.${domain}...`);
      await this.makeRequest(
        `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`,
        "PUT",
        dnsData,
      );
    } else {
      log.info(`Creating new DNS record for ${subdomain}.${domain}...`);
      await this.makeRequest(
        `${this.baseUrl}/zones/${zoneId}/dns_records`,
        "POST",
        dnsData,
      );
    }
  }

  public async startCloudflared() {
    const cloudflared = spawn(
      "cloudflared",
      ["tunnel", "--config", this.configPath, "--loglevel", "error", "run"],
      {
        detached: true,
        env: {
          ...process.env,
          // Set this to bypass origin cert requirement for named tunnels
          TUNNEL_ORIGIN_CERT: "/dev/null",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    cloudflared.stdout?.on("data", (data) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      log.info(data.toString().trim());
    });
    cloudflared.stderr?.on("data", (data) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      log.error(data.toString().trim());
    });

    cloudflared.on("error", (error) => {
      log.error("Failed to start cloudflared", {
        error: error.message,
      });
    });

    cloudflared.on("exit", (code, signal) => {
      if (code !== null) {
        log.error(`Cloudflared exited with code ${code}`, {
          exitCode: code,
          signal,
        });
      }
    });

    cloudflared.unref();
  }
}
