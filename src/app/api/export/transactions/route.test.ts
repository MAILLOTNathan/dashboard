import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireApiUserMock = vi.fn();
const listTransactionsMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({
  requireApiUser: () => requireApiUserMock(),
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Non autorisé." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }),
}));
vi.mock("@/modules/budget/repository", () => ({
  listTransactions: (...args: unknown[]) => listTransactionsMock(...args),
}));

const { GET } = await import("./route");

/**
 * Fictitious data only. What these tests pin down: the historical export keeps its
 * session gate, its owner-scoped read, its month boundaries (start inclusive, end
 * exclusive), its negative outflows untouched (a minus sign is not a formula), its
 * filters, and its row bound.
 */
const OWNER = { id: "owner-1", email: "owner@example.test", name: null };

const EXPENSE = {
  id: "tx-1",
  type: "EXPENSE",
  amount: new Decimal("-350.00"),
  currency: "EUR",
  operationDate: new Date(Date.UTC(2026, 8, 3)),
  label: "Courses alimentaires",
  accountId: "account-1",
  accountName: "Compte courant",
  categoryId: "category-1",
  categoryName: "Courses",
  notes: null,
  externalRef: null,
  transferGroupId: null,
  reconciledAt: null,
  createdAt: new Date(Date.UTC(2026, 8, 3, 8, 0)),
};

async function bodyOf(response: Response): Promise<string[]> {
  return (await response.text()).replace(/^\uFEFF/, "").split("\r\n");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 12, 0)));
  requireApiUserMock.mockReset().mockResolvedValue(OWNER);
  listTransactionsMock.mockReset().mockResolvedValue([EXPENSE]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/export/transactions", () => {
  it("refuses an unauthenticated request and reads nothing", async () => {
    requireApiUserMock.mockResolvedValue(null);

    const response = await GET(new Request("http://test.local/api/export/transactions"));

    expect(response.status).toBe(401);
    expect(listTransactionsMock).not.toHaveBeenCalled();
  });

  it("reads the requested month for the signed-in owner, end date exclusive", async () => {
    const response = await GET(
      new Request("http://test.local/api/export/transactions?month=2026-09"),
    );

    expect(response.status).toBe(200);
    expect(listTransactionsMock).toHaveBeenCalledTimes(1);

    const [userId, options] = listTransactionsMock.mock.calls[0] as [
      string,
      { from: Date; to: Date; take: number },
    ];
    expect(userId).toBe(OWNER.id);
    expect(options.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // Exclusive upper bound: the 1st of the next month is not part of September.
    expect(options.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(options.take).toBe(10_000);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions-2026-09.csv"',
    );
  });

  it("falls back to the current month when the filter is absent or malformed", async () => {
    await GET(new Request("http://test.local/api/export/transactions"));
    let options = listTransactionsMock.mock.calls.at(-1)?.[1] as { from: Date };
    expect(options.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");

    await GET(new Request("http://test.local/api/export/transactions?month=2026-9"));
    options = listTransactionsMock.mock.calls.at(-1)?.[1] as { from: Date };
    expect(options.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps a negative outflow as a number, dates as calendar days, and currencies explicit", async () => {
    const lines = await bodyOf(
      await GET(new Request("http://test.local/api/export/transactions?month=2026-09")),
    );

    expect(lines[0]).toBe(
      "date_operation,libelle,compte,categorie,type,montant,devise,pointe_le,notes,reference_source",
    );
    expect(lines[1]).toBe(
      "2026-09-03,Courses alimentaires,Compte courant,Courses,EXPENSE,-350.00,EUR,,,",
    );
  });

  it("writes the reconciliation day when the line was checked", async () => {
    listTransactionsMock.mockResolvedValue([
      { ...EXPENSE, reconciledAt: new Date(Date.UTC(2026, 9, 7)) },
    ]);

    const lines = await bodyOf(
      await GET(new Request("http://test.local/api/export/transactions?month=2026-09")),
    );

    expect(lines[1]).toContain(",2026-10-07,");
  });

  it("exports a whole year when asked, with an exclusive end and its own file name", async () => {
    const response = await GET(
      new Request("http://test.local/api/export/transactions?year=2026"),
    );

    const options = listTransactionsMock.mock.calls.at(-1)?.[1] as { from: Date; to: Date };
    expect(options.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(options.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions-2026.csv"',
    );
  });

  it("exports every month when all=1, and falls back to the month otherwise", async () => {
    const response = await GET(
      new Request("http://test.local/api/export/transactions?all=1"),
    );

    const options = listTransactionsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options.from).toBeUndefined();
    expect(options.to).toBeUndefined();
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions-complet.csv"',
    );

    // A malformed year falls back to the current month rather than 500 or an empty file.
    await GET(new Request("http://test.local/api/export/transactions?year=26"));
    const fallback = listTransactionsMock.mock.calls.at(-1)?.[1] as { from: Date };
    expect(fallback.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("forwards the reconciliation filter", async () => {
    await GET(
      new Request("http://test.local/api/export/transactions?month=2026-09&reconciled=0"),
    );

    const options = listTransactionsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options.reconciled).toBe(false);

    await GET(
      new Request("http://test.local/api/export/transactions?month=2026-09&reconciled=1"),
    );
    const checked = listTransactionsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(checked.reconciled).toBe(true);
  });

  it("forwards the account, category, type and search filters", async () => {
    await GET(
      new Request(
        "http://test.local/api/export/transactions?month=2026-09&account=a1&category=c1&type=EXPENSE&q=loyer",
      ),
    );

    const options = listTransactionsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options.accountId).toBe("a1");
    expect(options.categoryId).toBe("c1");
    expect(options.type).toBe("EXPENSE");
    expect(options.search).toBe("loyer");
  });

  it("ignores an unknown type instead of returning an empty file by accident", async () => {
    await GET(new Request("http://test.local/api/export/transactions?type=NOT_A_TYPE"));

    const options = listTransactionsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(options.type).toBeUndefined();
  });

  it("writes a header line even for a month without any operation", async () => {
    listTransactionsMock.mockResolvedValue([]);

    const lines = await bodyOf(
      await GET(new Request("http://test.local/api/export/transactions?month=2026-08")),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("date_operation");
  });

  it("neutralises a formula typed in a label", async () => {
    listTransactionsMock.mockResolvedValue([
      { ...EXPENSE, label: "=1+1", notes: "@SUM(A1:A9)" },
    ]);

    const lines = await bodyOf(
      await GET(new Request("http://test.local/api/export/transactions?month=2026-09")),
    );

    expect(lines[1]).toContain("'=1+1");
    expect(lines[1]).toContain("'@SUM(A1:A9)");
  });
});
