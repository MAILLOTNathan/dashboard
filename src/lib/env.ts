import { z } from "zod";

/**
 * Public configuration.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so anything declared here ends
 * up in the JavaScript shipped to the browser. Never add a secret to this block.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.string().trim().length(3).default("EUR"),
  NEXT_PUBLIC_DEFAULT_TIME_ZONE: z.string().trim().min(1).default("Europe/Paris"),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_DEFAULT_CURRENCY: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY,
  NEXT_PUBLIC_DEFAULT_TIME_ZONE: process.env.NEXT_PUBLIC_DEFAULT_TIME_ZONE,
});

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** PostgreSQL connection string. Server only. */
  DATABASE_URL: z.string().min(1),
  /** Auth.js session secret, 32 bytes minimum. */
  AUTH_SECRET: z.string().min(32),
  AUTH_TRUST_HOST: z.string().optional(),
  /** Base64 key used to encrypt provider tokens at rest. */
  INTEGRATION_ENCRYPTION_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server-only configuration, validated lazily.
 *
 * Validation happens on first use rather than at import time so that commands
 * which need no secret (lint, unit tests, static analysis) run without a
 * complete `.env`. A missing variable fails loudly with the list of names
 * instead of surfacing as an obscure runtime error.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() was called in the browser. Server configuration must never reach a client component.",
    );
  }

  if (!cachedServerEnv) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ");
      throw new Error(
        `Invalid or missing server environment variables: ${names}. Copy .env.example to .env and fill in the values.`,
      );
    }
    cachedServerEnv = parsed.data;
  }

  return cachedServerEnv;
}
