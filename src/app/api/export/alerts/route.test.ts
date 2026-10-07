import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiUserMock = vi.fn();
const listAlertsMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({
  requireApiUser: () => requireApiUserMock(),
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Non autorisé." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }),
}));
vi.mock("@/modules/alerts/repository", () => ({
  listAlerts: (...args: unknown[]) => listAlertsMock(...args),
}));

const { GET } = await import("./route");

/**
 * Fictitious data only. What these tests pin down: session first, owner-scoped and
 * bounded read, the status filter with its fallback, ISO instants, and a reason
 * recomputed from the stored inputs — the file and the screen share the same sentence.
 */
const OWNER = { id: "owner-1", email: "owner@example.test", name: null };

function alertRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    kind: "LOW_BALANCE",
    fingerprint: "low-balance:account-1",
    status: "ACTIVE",
    inputs: {
      accountName: "Compte courant",
      currency: "EUR",
      balance: "-10.00",
      threshold: "0.00",
    },
    triggeredAt: new Date(Date.UTC(2026, 9, 6, 8, 30)),
    lastSeenAt: new Date(Date.UTC(2026, 9, 6, 9, 0)),
    dismissedAt: null,
    resolvedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 6, 8, 30)),
    ...overrides,
  };
}

async function bodyOf(response: Response): Promise<string[]> {
  return (await response.text()).replace(/^\uFEFF/, "").split("\r\n");
}

beforeEach(() => {
  requireApiUserMock.mockReset().mockResolvedValue(OWNER);
  listAlertsMock.mockReset().mockResolvedValue([alertRecord()]);
});

describe("GET /api/export/alerts", () => {
  it("refuses an unauthenticated request and reads nothing", async () => {
    requireApiUserMock.mockResolvedValue(null);

    const response = await GET(new Request("http://test.local/api/export/alerts"));

    expect(response.status).toBe(401);
    expect(listAlertsMock).not.toHaveBeenCalled();
  });

  it("exports the episodes owner-scoped and bounded, with ISO instants", async () => {
    const response = await GET(new Request("http://test.local/api/export/alerts"));

    expect(response.status).toBe(200);
    expect(listAlertsMock).toHaveBeenCalledWith(OWNER.id, {
      status: undefined,
      take: 10_000,
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="alertes.csv"',
    );

    const lines = await bodyOf(response);
    expect(lines[0]).toBe(
      "type,statut,declenchee_le,vue_le,ecartee_le,resolue_le,raison",
    );
    // The reason is one quoted field (it contains commas); the amount inside keeps its
    // French formatting, including its narrow no-break space before the currency.
    expect(lines[1]).toMatch(
      /^LOW_BALANCE,ACTIVE,2026-10-06T08:30:00\.000Z,2026-10-06T09:00:00\.000Z,,,"Le solde de « Compte courant » est négatif : -10,00\s€\."$/,
    );
  });

  it("carries the dismissal and resolution instants when they exist", async () => {
    listAlertsMock.mockResolvedValue([
      alertRecord({
        status: "DISMISSED",
        dismissedAt: new Date(Date.UTC(2026, 9, 6, 10, 0)),
      }),
      alertRecord({
        id: "alert-2",
        status: "RESOLVED",
        resolvedAt: new Date(Date.UTC(2026, 9, 6, 11, 0)),
      }),
    ]);

    const lines = await bodyOf(await GET(new Request("http://test.local/api/export/alerts")));

    expect(lines[1]).toContain("2026-10-06T10:00:00.000Z");
    expect(lines[1]).toMatch(/DISMISSED/);
    expect(lines[2]).toContain("2026-10-06T11:00:00.000Z");
  });

  it("forwards a valid status filter and ignores an unknown one", async () => {
    await GET(new Request("http://test.local/api/export/alerts?status=RESOLVED"));
    expect(listAlertsMock).toHaveBeenLastCalledWith(OWNER.id, {
      status: "RESOLVED",
      take: 10_000,
    });

    await GET(new Request("http://test.local/api/export/alerts?status=resolved"));
    expect(listAlertsMock).toHaveBeenLastCalledWith(OWNER.id, {
      status: undefined,
      take: 10_000,
    });
  });

  it("writes a header line even without any alert", async () => {
    listAlertsMock.mockResolvedValue([]);

    const lines = await bodyOf(await GET(new Request("http://test.local/api/export/alerts")));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("raison");
  });

  it("escapes a reason that carries quotes and separators without breaking the file", async () => {
    // A label cannot lead the reason, so the CSV guards act on separators here; the
    // leading-character neutralisation is covered by the budgets, goals and
    // transactions exports and by `csv.test.ts`.
    listAlertsMock.mockResolvedValue([
      alertRecord({
        kind: "UNUSUAL_EXPENSE",
        inputs: {
          label: 'Achat "urgent", chez l\'imprimeur',
          amount: "650.00",
          currency: "EUR",
          date: "2026-10-03",
          threshold: "500.00",
        },
      }),
    ]);

    const lines = await bodyOf(await GET(new Request("http://test.local/api/export/alerts")));

    // The whole reason stays one field: it is quoted, with inner quotes doubled.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('""urgent"",');
    expect(lines[1]).toContain("650,00");
  });
});
