import { describe, expect, test } from "vitest";
import {
  isCloudflareIp,
  isCloudflareOrLoopbackIp,
  isLoopbackIp,
} from "../../src/server/Cloudflare";

describe("Cloudflare IP Validation", () => {
  describe("isLoopbackIp", () => {
    test("identifies standard loopback IPs", () => {
      expect(isLoopbackIp("127.0.0.1")).toBe(true);
      expect(isLoopbackIp("::1")).toBe(true);
      expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
      expect(isLoopbackIp("localhost")).toBe(true);
    });

    test("returns false for non-loopback IPs", () => {
      expect(isLoopbackIp("8.8.8.8")).toBe(false);
      expect(isLoopbackIp("192.168.1.1")).toBe(false);
      expect(isLoopbackIp("")).toBe(false);
    });
  });

  describe("isCloudflareIp", () => {
    test("returns true for valid Cloudflare IPv4 addresses", () => {
      expect(isCloudflareIp("173.245.48.5")).toBe(true);
      expect(isCloudflareIp("::ffff:173.245.48.5")).toBe(true);
      expect(isCloudflareIp("103.21.244.1")).toBe(true);
      expect(isCloudflareIp("104.16.0.2")).toBe(true);
      expect(isCloudflareIp("172.64.0.9")).toBe(true);
    });

    test("returns true for valid Cloudflare IPv6 addresses", () => {
      expect(isCloudflareIp("2400:cb00:0000:0000:0000:0000:0000:0001")).toBe(
        true,
      );
      expect(isCloudflareIp("2400:cb00::1")).toBe(true);
      expect(isCloudflareIp("2606:4700::ffff")).toBe(true);
    });

    test("returns false for non-Cloudflare IPs", () => {
      expect(isCloudflareIp("8.8.8.8")).toBe(false);
      expect(isCloudflareIp("1.1.1.1")).toBe(false);
      expect(isCloudflareIp("192.168.1.1")).toBe(false);
      expect(isCloudflareIp("2001:4860:4860::8888")).toBe(false);
      expect(isCloudflareIp("")).toBe(false);
    });
  });

  describe("isCloudflareOrLoopbackIp", () => {
    test("returns true for both loopback and Cloudflare IPs", () => {
      expect(isCloudflareOrLoopbackIp("127.0.0.1")).toBe(true);
      expect(isCloudflareOrLoopbackIp("173.245.48.5")).toBe(true);
    });

    test("returns false for regular external IPs", () => {
      expect(isCloudflareOrLoopbackIp("8.8.8.8")).toBe(false);
    });
  });
});
