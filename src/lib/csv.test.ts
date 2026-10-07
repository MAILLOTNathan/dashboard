import { describe, expect, it } from "vitest";
import { createCsvResponse, escapeCsvValue, EXPORT_ROW_LIMIT, toCsv } from "./csv";

type Row = { name: string; amount: string };

const COLUMNS = [
  { key: "name" as const, header: "libelle" },
  { key: "amount" as const, header: "montant" },
];

describe("escapeCsvValue", () => {
  it("leaves a simple value untouched", () => {
    expect(escapeCsvValue("Courses")).toBe("Courses");
  });

  it("renders null and undefined as an empty field", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvValue("Loyer, charges")).toBe('"Loyer, charges"');
  });

  it("doubles the quotes inside a quoted value", () => {
    expect(escapeCsvValue('Libellé "urgent"')).toBe('"Libellé ""urgent"""');
  });

  it("quotes a value containing a line break", () => {
    expect(escapeCsvValue("ligne1\nligne2")).toBe('"ligne1\nligne2"');
  });

  it("keeps a negative amount as a number, without neutralising the minus sign", () => {
    // Exports use a dot as the decimal separator, so no comma is involved and
    // the value stays an unquoted number.
    expect(escapeCsvValue("-45.90")).toBe("-45.90");
  });

  it("quotes a value written with a decimal comma, as any value containing a comma", () => {
    expect(escapeCsvValue("-45,90")).toBe('"-45,90"');
  });

  it("defuses a spreadsheet formula typed in a label", () => {
    // Without this guard, opening the file in Excel would run the formula.
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(escapeCsvValue("+33 6 00 00 00 00")).toBe("'+33 6 00 00 00 00");
  });
});

describe("toCsv", () => {
  it("writes a header line even without any row", () => {
    expect(toCsv<Row>([], COLUMNS)).toBe("libelle,montant");
  });

  it("writes one line per row", () => {
    const csv = toCsv<Row>(
      [
        { name: "Loyer", amount: "900.00" },
        { name: "Charges, copropriété", amount: "-120.00" },
      ],
      COLUMNS,
    );

    expect(csv.split("\r\n")).toEqual([
      "libelle,montant",
      "Loyer,900.00",
      '"Charges, copropriété",-120.00',
    ]);
  });

  it("handles a full-size export in one pass, inside the documented bound", () => {
    // EXPORT_ROW_LIMIT is what every export route passes to its read: the writer must
    // stay predictable at that size, and the line count must be exactly rows + header.
    const rows = Array.from({ length: EXPORT_ROW_LIMIT }, (_, index) => ({
      name: `Ligne ${index}`,
      amount: "-45.90",
    }));

    const lines = toCsv<Row>(rows, COLUMNS).split("\r\n");

    expect(lines).toHaveLength(EXPORT_ROW_LIMIT + 1);
    expect(lines[1]).toBe("Ligne 0,-45.90");
    expect(lines.at(-1)).toBe(`Ligne ${EXPORT_ROW_LIMIT - 1},-45.90`);
  });
});

describe("createCsvResponse", () => {
  it("serves a downloadable, non-cacheable CSV file", async () => {
    const response = createCsvResponse("libelle\r\nLoyer", "transactions-2026-09.csv");

    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="transactions-2026-09.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    // The BOM keeps accents readable when the file is opened in Excel. It is
    // checked on the raw bytes: `text()` strips a leading BOM while decoding.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await new Response(bytes).text()).toContain("Loyer");
  });
});
