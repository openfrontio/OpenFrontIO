import { spawn } from "child_process";
import * as fs from "fs";
import { logger } from "./Logger";

const log = logger.child({
  module: "cloudflare",
});

export interface TunnelConfig {
  domain: string;
  subdomain: string;
  subdomainToService: Map<string, string>;
}

interface TunnelResponse {
  result: {
    id: string;
    token: string;
  };
}

interface ZoneResponse {
  result: Array<{
    id: string;
  }>;
}

interface DNSRecordResponse {
  result: Array<{
    id: string;
  }>;
}

export class Cloudflare {
  private baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(
    private accountId: string,
    private apiToken: string,
  ) {}

  private async makeRequest<T>(
    url: string,
    method: string = "GET",
    data?: any,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare API error: ${response.status} - ${errorText}`,
      );
    }

    return response.json() as Promise<T>;
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

    const tunnelResponse = await this.makeRequest<TunnelResponse>(
      `${this.baseUrl}/accounts/${this.accountId}/cfd_tunnel`,
      "POST",
      { name: tunnelName },
    );

    const tunnelId = tunnelResponse.result.id;
    const tunnelToken = tunnelResponse.result.token;

    if (!tunnelId || tunnelId === "null") {
      throw new Error("Failed to create tunnel");
    }

    log.info(`Tunnel created with ID: ${tunnelId}`);

    await this.configureTunnel(tunnelId, subdomain, domain, subdomainToService);

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

  private async configureTunnel(
    tunnelId: string,
    subdomain: string,
    domain: string,
    subdomainToService: Map<string, string>,
  ): Promise<void> {
    log.info(`Configuring tunnel to point to ${subdomain}.${domain}...`);

    const request = {
      config: {
        ingress: [
          ...Array.from(subdomainToService.entries()).map(
            ([subdomain, service]) => ({
              hostname: `${subdomain}.${domain}`,
              service: service,
            }),
          ),
          {
            service: "http_status:404",
          },
        ],
      },
    };
    await this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/cfd_tunnel/${tunnelId}/configurations`,
      "PUT",
      request,
    );
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
      type: "CNAME",
      name: subdomain,
      content: `${tunnelId}.cfargotunnel.com`,
      ttl: 1,
      proxied: true,
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

  public async deleteTunnel(tunnelId: string): Promise<void> {
    log.info(`Deleting tunnel with ID: ${tunnelId}`);

    await this.makeRequest(
      `${this.baseUrl}/accounts/${this.accountId}/cfd_tunnel/${tunnelId}`,
      "DELETE",
    );

    log.info("Tunnel deleted successfully");
  }

  public async listTunnels(): Promise<any[]> {
    const response = await this.makeRequest<{ result: any[] }>(
      `${this.baseUrl}/accounts/${this.accountId}/cfd_tunnel`,
    );

    return response.result;
  }

  public async deleteDNSRecord(
    subdomain: string,
    domain: string,
  ): Promise<void> {
    log.info(`Deleting DNS record for ${subdomain}.${domain}...`);

    // Get zone ID
    const zoneResponse = await this.makeRequest<ZoneResponse>(
      `${this.baseUrl}/zones?name=${domain}`,
    );

    const zoneId = zoneResponse.result[0]?.id;
    if (!zoneId) {
      throw new Error(`Could not find zone ID for domain ${domain}`);
    }

    // Get DNS record
    const existingRecords = await this.makeRequest<DNSRecordResponse>(
      `${this.baseUrl}/zones/${zoneId}/dns_records?name=${subdomain}.${domain}`,
    );

    const recordId = existingRecords.result[0]?.id;
    if (!recordId) {
      log.info("No DNS record found to delete");
      return;
    }

    // Delete DNS record
    await this.makeRequest(
      `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`,
      "DELETE",
    );

    log.info("DNS record deleted successfully");
  }

  public async startCloudflared(tunnelToken: string) {
    const out = fs.openSync("./cloudflared.out.log", "a");
    const err = fs.openSync("./cloudflared.err.log", "a");

    const cloudflared = spawn(
      "cloudflared",
      ["tunnel", "run", "--token", tunnelToken],
      {
        detached: true,
        stdio: ["ignore", out, err],
      },
    );
    cloudflared.unref();
  }
}
