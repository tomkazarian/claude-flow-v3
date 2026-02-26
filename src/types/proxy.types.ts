import { z } from "zod";

// ---------------------------------------------------------------------------
// String literal unions
// ---------------------------------------------------------------------------

export type ProxyProvider =
  | "brightdata"
  | "oxylabs"
  | "smartproxy"
  | "iproyal"
  | "webshare"
  | "custom";

export type ProxyProtocol = "http" | "https" | "socks5";

export type ProxyType = "residential" | "datacenter" | "mobile";

export type ProxyHealthStatus = "healthy" | "degraded" | "dead" | "unknown";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface Proxy {
  id: string;
  provider: ProxyProvider | null;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  protocol: ProxyProtocol;
  country: string | null;
  state: string | null;
  city: string | null;
  type: ProxyType | null;
  isActive: boolean;
  lastHealthCheck: string | null;
  healthStatus: ProxyHealthStatus;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  /** Rotation strategy for selecting proxies */
  rotationStrategy: "round-robin" | "random" | "least-used" | "geo-match";

  /** Maximum consecutive failures before marking a proxy as dead */
  maxConsecutiveFailures: number;

  /** Interval in milliseconds between health checks */
  healthCheckIntervalMs: number;

  /** Timeout in milliseconds for health check requests */
  healthCheckTimeoutMs: number;

  /** URL to use for health check connectivity tests */
  healthCheckUrl: string;

  /** Whether to prefer residential proxies over datacenter */
  preferResidential: boolean;

  /** Country codes to filter proxies by (empty = no filter) */
  geoFilter: string[];

  /** Maximum number of proxies to keep in the active pool */
  poolSize: number;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const proxyProviderSchema = z.enum([
  "brightdata",
  "oxylabs",
  "smartproxy",
  "iproyal",
  "webshare",
  "custom",
]);

export const proxyProtocolSchema = z.enum(["http", "https", "socks5"]);

export const proxyTypeSchema = z.enum(["residential", "datacenter", "mobile"]);

export const proxyHealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "dead",
  "unknown",
]);

export const proxyConfigSchema = z.object({
  rotationStrategy: z.enum([
    "round-robin",
    "random",
    "least-used",
    "geo-match",
  ]),
  maxConsecutiveFailures: z.number().int().min(1).max(100),
  healthCheckIntervalMs: z.number().int().min(10_000),
  healthCheckTimeoutMs: z.number().int().min(1_000).max(30_000),
  healthCheckUrl: z.string().url(),
  preferResidential: z.boolean(),
  geoFilter: z.array(z.string().length(2)),
  poolSize: z.number().int().min(1).max(1000),
});
