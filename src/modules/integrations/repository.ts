import { getPrisma } from "@/lib/db";
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "@/lib/crypto";
import { getServerEnv } from "@/lib/env";
import {
  describeInstance,
  type ConnectionSummary,
  type IntegrationProvider,
  type IntegrationStatus,
  type IssueKind,
  type ProviderIssue,
  type ProviderProject,
} from "./domain";

/**
 * Persistence for provider connections.
 *
 * A token is encrypted before it is written and is never read back into a
 * response: `listConnections` returns `hasStoredToken` instead of the value.
 */

function encryptionKey(): Buffer {
  return decodeEncryptionKey(getServerEnv().INTEGRATION_ENCRYPTION_KEY);
}

export async function listConnections(
  userId: string,
): Promise<ConnectionSummary[]> {
  const rows = await getPrisma().integrationConnection.findMany({
    where: { userId },
    orderBy: { provider: "asc" },
    select: {
      id: true,
      provider: true,
      instanceUrl: true,
      externalOwner: true,
      permissions: true,
      status: true,
      lastSyncedAt: true,
      lastSyncError: true,
      credentialsCiphertext: true,
      _count: { select: { snapshots: true, issues: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider as IntegrationProvider,
    instanceUrl: row.instanceUrl,
    externalOwner: row.externalOwner,
    permissions: row.permissions,
    status: row.status as IntegrationStatus,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
    hasStoredToken: Boolean(row.credentialsCiphertext),
    projectCount: row._count.snapshots,
    issueCount: row._count.issues,
  }));
}

export type ConnectionWithSecret = {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  instanceUrl: string;
  externalOwner: string | null;
  token: string | null;
};

/** Server-internal: the only function that decrypts a token. */
export async function findConnectionForSync(
  userId: string,
  connectionId: string,
): Promise<ConnectionWithSecret | null> {
  const row = await getPrisma().integrationConnection.findFirst({
    where: { id: connectionId, userId },
    select: {
      id: true,
      userId: true,
      provider: true,
      instanceUrl: true,
      externalOwner: true,
      credentialsCiphertext: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as IntegrationProvider,
    instanceUrl: row.instanceUrl,
    externalOwner: row.externalOwner,
    token: row.credentialsCiphertext
      ? decryptStoredToken(row.credentialsCiphertext)
      : null,
  };
}

/**
 * A token written with a previous encryption key must mark the connection as
 * broken, not crash an entire synchronisation run. Returning `null` lets the
 * caller report "credential unreadable, reconnect" instead of failing blindly.
 */
function decryptStoredToken(ciphertext: string): string | null {
  try {
    return decryptSecret(ciphertext, encryptionKey());
  } catch {
    return null;
  }
}

export async function upsertConnection(input: {
  userId: string;
  provider: IntegrationProvider;
  instanceUrl: string;
  externalOwner: string | null;
  permissions: string[];
  token: string;
  status?: IntegrationStatus;
}): Promise<{ id: string }> {
  const credentialsCiphertext = encryptSecret(input.token, encryptionKey());

  return getPrisma().integrationConnection.upsert({
    where: {
      userId_provider_instanceUrl: {
        userId: input.userId,
        provider: input.provider,
        instanceUrl: input.instanceUrl,
      },
    },
    create: {
      userId: input.userId,
      provider: input.provider,
      instanceUrl: input.instanceUrl,
      externalOwner: input.externalOwner,
      permissions: input.permissions,
      credentialsCiphertext,
      status: input.status ?? "CONNECTED",
    },
    update: {
      externalOwner: input.externalOwner,
      permissions: input.permissions,
      credentialsCiphertext,
      status: input.status ?? "CONNECTED",
      // A new token clears the previous failure.
      lastSyncError: null,
    },
    select: { id: true },
  });
}

/**
 * Stores the normalised projects of one synchronisation.
 *
 * Upserting on (connectionId, externalId) makes a re-run idempotent: replaying a
 * synchronisation updates rows instead of duplicating them.
 *
 * `pruneMissing` deletes snapshots the provider no longer returns. It is only
 * safe once a synchronisation has completed **all** its pages: a partial run
 * would otherwise erase projects that were merely not fetched.
 */
export async function saveSnapshots(input: {
  connectionId: string;
  provider: IntegrationProvider;
  projects: readonly ProviderProject[];
  fetchedAt: Date;
  pruneMissing?: boolean;
}): Promise<number> {
  const prisma = getPrisma();

  for (const project of input.projects) {
    await prisma.projectSnapshot.upsert({
      where: {
        connectionId_externalId: {
          connectionId: input.connectionId,
          externalId: project.externalId,
        },
      },
      create: {
        connectionId: input.connectionId,
        provider: input.provider,
        externalId: project.externalId,
        externalUrl: project.externalUrl,
        name: project.name,
        visibility: project.visibility,
        metrics: project.metrics as never,
        fetchedAt: input.fetchedAt,
      },
      update: {
        externalUrl: project.externalUrl,
        name: project.name,
        visibility: project.visibility,
        metrics: project.metrics as never,
        fetchedAt: input.fetchedAt,
      },
    });
  }

  if (input.pruneMissing) {
    await prisma.projectSnapshot.deleteMany({
      where: {
        connectionId: input.connectionId,
        externalId: { notIn: input.projects.map((project) => project.externalId) },
      },
    });
  }

  return input.projects.length;
}

export async function markSyncSuccess(
  connectionId: string,
  fetchedAt: Date,
): Promise<void> {
  await getPrisma().integrationConnection.update({
    where: { id: connectionId },
    data: { status: "CONNECTED", lastSyncedAt: fetchedAt, lastSyncError: null },
  });
}

/**
 * Records a failure while keeping the last successful time: the interface must
 * show "synchronisation failed", not an empty dashboard.
 */
export async function markSyncFailure(
  connectionId: string,
  safeMessage: string,
): Promise<void> {
  await getPrisma().integrationConnection.update({
    where: { id: connectionId },
    data: { status: "ERROR", lastSyncError: safeMessage },
  });
}

/**
 * One issue as the interface displays it. Never a provider payload.
 */
export type IssueSummary = {
  id: string;
  kind: IssueKind;
  provider: IntegrationProvider;
  /** Instance the issue comes from, so two connections stay distinguishable. */
  connectionLabel: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  commentsCount: number;
  labels: string[];
  openedAt: Date;
  activityAt: Date;
};

/**
 * Stores the open issues and pull requests of one synchronisation.
 *
 * Same idempotency rule as the project snapshots: upserting on
 * (connectionId, externalId) makes a re-run update rows instead of duplicating
 * them. `pruneMissing` deletes what the provider no longer reports as open —
 * a closed issue must leave this list, which is what keeps it a to-do list and not
 * an archive. It is only safe once every targeted repository was read: a repository
 * skipped by the bound, or refused by the provider, would have its issues erased
 * while they are still open.
 */
export async function saveIssues(input: {
  connectionId: string;
  provider: IntegrationProvider;
  issues: readonly ProviderIssue[];
  fetchedAt: Date;
  pruneMissing?: boolean;
}): Promise<number> {
  const prisma = getPrisma();

  for (const issue of input.issues) {
    const data = {
      provider: input.provider,
      kind: issue.kind,
      repository: issue.repository,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      authorLogin: issue.authorLogin,
      commentsCount: issue.commentsCount,
      labels: issue.labels,
      openedAt: issue.openedAt,
      activityAt: issue.activityAt,
      fetchedAt: input.fetchedAt,
    };

    await prisma.issueSnapshot.upsert({
      where: {
        connectionId_externalId: {
          connectionId: input.connectionId,
          externalId: issue.externalId,
        },
      },
      create: { connectionId: input.connectionId, externalId: issue.externalId, ...data },
      update: data,
    });
  }

  if (input.pruneMissing) {
    await prisma.issueSnapshot.deleteMany({
      where: {
        connectionId: input.connectionId,
        externalId: { notIn: input.issues.map((issue) => issue.externalId) },
      },
    });
  }

  return input.issues.length;
}

/**
 * Every open issue and pull request followed by this owner, newest first.
 *
 * Scoped through the connection, so a query can never return another owner's
 * issues. The volume is bounded by the synchronisation itself (the most recently
 * active repositories, a fixed page size per repository), which is why the whole
 * set is returned: the page computes its indicators on all of it and only the
 * table is truncated.
 */
export async function listIssues(userId: string): Promise<IssueSummary[]> {
  const rows = await getPrisma().issueSnapshot.findMany({
    where: { connection: { userId } },
    orderBy: [{ openedAt: "desc" }],
    select: {
      id: true,
      kind: true,
      provider: true,
      repository: true,
      number: true,
      title: true,
      url: true,
      authorLogin: true,
      commentsCount: true,
      labels: true,
      openedAt: true,
      activityAt: true,
      connection: { select: { instanceUrl: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as IssueKind,
    provider: row.provider as IntegrationProvider,
    connectionLabel: describeInstance(
      row.provider as IntegrationProvider,
      row.connection.instanceUrl,
    ),
    repository: row.repository,
    number: row.number,
    title: row.title,
    url: row.url,
    authorLogin: row.authorLogin,
    commentsCount: row.commentsCount,
    labels: row.labels,
    openedAt: row.openedAt,
    activityAt: row.activityAt,
  }));
}
