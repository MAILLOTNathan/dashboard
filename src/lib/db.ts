import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";

/**
 * Database access. Server only: importing this module from a client component
 * would leak the connection string into the browser bundle.
 *
 * Prisma 7 requires an explicit driver adapter, so the connection string is
 * supplied here and never stored in `schema.prisma`.
 */
const globalForPrisma = globalThis as unknown as {
  dashboardPrisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getPrisma() was called in the browser. Never import a database client into a client component.",
    );
  }

  if (!globalForPrisma.dashboardPrisma) {
    const adapter = new PrismaPg({
      connectionString: getServerEnv().DATABASE_URL,
    });
    globalForPrisma.dashboardPrisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.dashboardPrisma;
}
