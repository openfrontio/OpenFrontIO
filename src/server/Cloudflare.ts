import net from "net";

export const CLOUDFLARE_IPV4_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

export const CLOUDFLARE_IPV6_CIDRS = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function ip4ToInt(ip: string): number {
  const parts = ip.split(".").map((part) => parseInt(part, 10));
  return (
    ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  );
}

function checkIPv4InCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipInt = ip4ToInt(ip);
  const rangeInt = ip4ToInt(range);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ip6ToBigInt(ip: string): bigint {
  let fullIp = ip;
  if (ip.includes("::")) {
    const parts = ip.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missingCount = 8 - (left.length + right.length);
    const middle = Array(missingCount).fill("0");
    fullIp = [...left, ...middle, ...right].join(":");
  }
  const parts = fullIp
    .split(":")
    .map((part) => (part === "" ? 0n : BigInt(parseInt(part, 16))));
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) + part;
  }
  return result;
}

function checkIPv6InCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipVal = ip6ToBigInt(ip);
  const rangeVal = ip6ToBigInt(range);
  const mask =
    bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return (ipVal & mask) === (rangeVal & mask);
}

export function isCloudflareIp(ip: string): boolean {
  if (!ip) return false;
  // Convert mapped IPv4 address (e.g. ::ffff:173.245.48.5) to standard IPv4
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  if (net.isIPv4(ip)) {
    return CLOUDFLARE_IPV4_CIDRS.some((cidr) => checkIPv4InCIDR(ip, cidr));
  }
  if (net.isIPv6(ip)) {
    return CLOUDFLARE_IPV6_CIDRS.some((cidr) => checkIPv6InCIDR(ip, cidr));
  }
  return false;
}

export function isLoopbackIp(ip: string): boolean {
  if (!ip) return false;
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

export function isCloudflareOrLoopbackIp(ip: string): boolean {
  return isLoopbackIp(ip) || isCloudflareIp(ip);
}
