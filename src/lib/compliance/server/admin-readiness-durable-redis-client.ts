import "server-only";

import { Redis } from "@upstash/redis";

export type AdminReadinessRedisEnvironment = "production" | "staging" | "preview" | "local";

export type AdminReadinessRedisCommandClient = Readonly<{
  get(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: unknown[]): Promise<unknown>;
}>;

export type AdminReadinessDurableRedisConfiguration = Readonly<{
  environment: AdminReadinessRedisEnvironment;
  redisEnvironment: AdminReadinessRedisEnvironment;
  namespace: string;
  url: string;
  token: string;
}>;

const ENVIRONMENTS = new Set<AdminReadinessRedisEnvironment>(["production", "staging", "preview", "local"]);
const NAMESPACE = /^admin_readiness_(production|staging|preview|local)_v1$/;

function validEnvironment(value: unknown): value is AdminReadinessRedisEnvironment {
  return typeof value === "string" && ENVIRONMENTS.has(value as AdminReadinessRedisEnvironment);
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 4_096 && !/\s/.test(value);
}

function validNamespace(value: unknown, environment: AdminReadinessRedisEnvironment): value is string {
  return typeof value === "string" && NAMESPACE.test(value) && value === `admin_readiness_${environment}_v1`;
}

function processConfiguration(): unknown {
  return {
    environment: process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT,
    redisEnvironment: process.env.DERALEDGER_ADMIN_READINESS_REDIS_ENVIRONMENT,
    namespace: process.env.DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE,
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

/** Validates only server-side Redis inputs; it never logs a value or creates network traffic. */
export function validateAdminReadinessDurableRedisConfiguration(value: unknown): AdminReadinessDurableRedisConfiguration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<AdminReadinessDurableRedisConfiguration>;
  if (!validEnvironment(input.environment) || !validEnvironment(input.redisEnvironment)
    || input.environment !== input.redisEnvironment || !validNamespace(input.namespace, input.environment)
    || !validUrl(input.url) || !validToken(input.token)) return null;
  return {
    environment: input.environment,
    redisEnvironment: input.redisEnvironment,
    namespace: input.namespace,
    url: input.url,
    token: input.token,
  };
}

/**
 * Creates the narrow command client only after complete configuration validation.
 * It has no network operation itself; commands are issued only by storage adapters.
 */
export function createAdminReadinessDurableRedisClient(
  configuration: unknown = processConfiguration(),
): Readonly<{ client: AdminReadinessRedisCommandClient; configuration: Pick<AdminReadinessDurableRedisConfiguration, "environment" | "namespace"> }> | null {
  const validated = validateAdminReadinessDurableRedisConfiguration(configuration);
  if (!validated) return null;
  try {
    const redis = new Redis({ url: validated.url, token: validated.token, automaticDeserialization: false });
    return {
      client: {
        get(key) { return redis.get(key); },
        eval(script, keys, args) { return redis.eval(script, keys, args); },
      },
      configuration: { environment: validated.environment, namespace: validated.namespace },
    };
  } catch {
    return null;
  }
}
