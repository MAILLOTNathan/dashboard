import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  detectDelimiter,
  emptyMapping,
  guessMapping,
  importExternalRef,
  IMPORT_ROW_LIMIT,
  importRowKey,
  missingMappingReasons,
  parseCsv,
  parseImportAmount,
  parseImportDate,
} from "./import";

/**
 * Fictitious CSV content only. The parser and the mapping rules are pure, so they are
 * tested without a browser and without a file.
 */

describe("parseCsv", () => {
  it("splits rows and cells on the delimiter", () => {
    expect(parseCsv("a;b;c\n1;2;3", ";")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps delimiters and line breaks inside quoted fields", () => {
    const table = parseCsv('label;"mon; libellé";note\n"ligne\nsuivante";"x";"y"', ";");

    expect(table).toEqual([
      ["label", "mon; libellé", "note"],
      ["ligne\nsuivante", "x", "y"],
    ]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('"dit ""bonjour""";x', ";")).toEqual([['dit "bonjour"', "x"]]);
  });

  it("strips a BOM and handles CRLF", () => {
    expect(parseCsv("\uFEFFa;b\r\n1;2\r\n", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not add a phantom row for a trailing newline", () => {
    expect(parseCsv("a;b\n", ";")).toEqual([["a", "b"]]);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent candidate on the first line", () => {
    expect(detectDelimiter("a;b;c;d")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb")).toBe("\t");
  });

  it("ignores candidates inside quotes", () => {
    expect(detectDelimiter('"a,b,c,d";e')).toBe(";");
  });

  it("falls back to semicolon on an empty sample", () => {
    expect(detectDelimiter("\n\n")).toBe(";");
  });
});

describe("parseImportAmount", () => {
  it("accepts the formats the amount parser already knows", () => {
    expect(parseImportAmount("1 234,56").toFixed(2)).toBe("1234.56");
    expect(parseImportAmount("-45,90").toFixed(2)).toBe("-45.90");
    expect(parseImportAmount("12.50").toFixed(2)).toBe("12.50");
  });

  it("reads accounting parentheses as a negative amount", () => {
    expect(parseImportAmount("(45,90)").toFixed(2)).toBe("-45.90");
  });

  it("refuses an unreadable amount instead of guessing", () => {
    expect(() => parseImportAmount("")).toThrow();
    expect(() => parseImportAmount("abc")).toThrow();
    expect(() => parseImportAmount("12,345")).toThrow();
  });
});

describe("parseImportDate", () => {
  it("reads ISO and day-first French forms", () => {
    expect(parseImportDate("2026-10-05").toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(parseImportDate("05/10/2026").toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(parseImportDate("5-10-2026").toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(parseImportDate("05.10.2026").toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("expands a two-digit year to the 2000s", () => {
    expect(parseImportDate("05/10/26").toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("refuses an impossible day: the calendar check is shared", () => {
    expect(() => parseImportDate("31/02/2026")).toThrow();
  });

  it("refuses ambiguous or unknown formats rather than guessing", () => {
    expect(() => parseImportDate("10/2026")).toThrow();
    expect(() => parseImportDate("octobre")).toThrow();
  });
});

describe("guessMapping", () => {
  it("recognises the usual French bank headers", () => {
    const mapping = guessMapping(["Date", "Libellé", "Débit", "Crédit"]);

    expect(mapping.date).toBe(0);
    expect(mapping.label).toBe(1);
    expect(mapping.debit).toBe(2);
    expect(mapping.credit).toBe(3);
    expect(mapping.amount).toBeNull();
  });

  it("recognises English headers and never assigns one column twice", () => {
    const mapping = guessMapping(["Booking date", "Amount", "Description", "Reference"]);

    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBe(1);
    expect(mapping.label).toBe(2);
    expect(mapping.reference).toBe(3);
  });

  it("leaves unknown columns unassigned", () => {
    const mapping = guessMapping(["Colonne 1", "Colonne 2"]);

    expect(mapping).toEqual(emptyMapping());
  });
});

describe("missingMappingReasons", () => {
  it("lists what is missing, and stays empty when the mapping is complete", () => {
    expect(missingMappingReasons(emptyMapping())).toHaveLength(3);

    const complete = missingMappingReasons({ ...emptyMapping(), date: 0, label: 1, amount: 2 });
    expect(complete).toEqual([]);

    const withDebitCredit = missingMappingReasons({
      ...emptyMapping(),
      date: 0,
      label: 1,
      debit: 2,
      credit: 3,
    });
    expect(withDebitCredit).toEqual([]);
  });
});

describe("buildImportRows", () => {
  const mapping = { ...emptyMapping(), date: 0, label: 1, amount: 2 };

  it("builds normalised rows and skips blank lines", () => {
    const build = buildImportRows({
      table: [
        ["Date", "Libellé", "Montant"],
        ["05/10/2026", "  Courses  ", "-45,90"],
        ["", "", ""],
        ["06/10/2026", "Salaire", "2 000,00"],
      ],
      mapping,
      hasHeader: true,
    });

    expect(build.dataLineCount).toBe(2);
    expect(build.rows).toHaveLength(2);
    expect(build.rows[0]).toMatchObject({ line: 2, date: "2026-10-05", amount: "-45.90" });
    expect(build.rows[0].errors).toEqual([]);
    // The label is trimmed on the way in.
    expect(build.rows[0].label).toBe("Courses");
    expect(build.rows[1].amount).toBe("2000.00");
  });

  it("computes the amount from a debit/credit pair", () => {
    const pairMapping = { ...emptyMapping(), date: 0, label: 1, debit: 2, credit: 3 };

    const build = buildImportRows({
      table: [
        ["01/10/2026", "Loyer", "950,00", ""],
        ["02/10/2026", "Remboursement", "", "120,50"],
      ],
      mapping: pairMapping,
      hasHeader: false,
    });

    expect(build.rows[0].amount).toBe("-950.00");
    expect(build.rows[1].amount).toBe("120.50");
  });

  it("reports the row errors that block a line, instead of importing it", () => {
    const build = buildImportRows({
      table: [
        ["pas une date", "Courses", "-45,90"],
        ["2026-10-05", "", "10,00"],
        ["2026-10-06", "Café", "abc"],
        ["2026-10-07", "Zéro", "0,00"],
      ],
      mapping,
      hasHeader: false,
    });

    expect(build.rows[0].errors[0]).toMatch(/Date illisible/);
    expect(build.rows[1].errors[0]).toMatch(/Libellé manquant/);
    expect(build.rows[2].errors[0]).toMatch(/Montant illisible/);
    expect(build.rows[3].errors[0]).toMatch(/Montant nul/);
    // An unreadable row keeps its line number so the file can be fixed.
    expect(build.rows[0].line).toBe(1);
  });

  it("truncates an over-long label to fit the transaction contract, and counts it", () => {
    const longLabel = "x".repeat(250);
    const build = buildImportRows({
      table: [["2026-10-05", longLabel, "-1,00"]],
      mapping,
      hasHeader: false,
    });

    expect(build.rows[0].label).toHaveLength(200);
    expect(build.rows[0].labelTruncated).toBe(true);
    expect(build.labelTruncatedCount).toBe(1);
    expect(build.rows[0].errors).toEqual([]);
  });

  it("stops at the row limit and says the file was cut", () => {
    const table = Array.from({ length: IMPORT_ROW_LIMIT + 10 }, (_, index) => [
      "2026-10-05",
      `Ligne ${index}`,
      "-1,00",
    ]);

    const build = buildImportRows({ table, mapping, hasHeader: false });

    expect(build.truncated).toBe(true);
    expect(build.rows).toHaveLength(IMPORT_ROW_LIMIT);
  });

  it("carries reference, category and notes through, normalising empties to null", () => {
    const richMapping = {
      ...emptyMapping(),
      date: 0,
      label: 1,
      amount: 2,
      reference: 3,
      category: 4,
      notes: 5,
    };

    const build = buildImportRows({
      table: [["2026-10-05", "Courses", "-45,90", "REF-1", "Alimentation", ""]],
      mapping: richMapping,
      hasHeader: false,
    });

    expect(build.rows[0].reference).toBe("REF-1");
    expect(build.rows[0].categoryName).toBe("Alimentation");
    expect(build.rows[0].notes).toBeNull();
  });
});

describe("importRowKey", () => {
  const row = { date: "2026-10-05", label: "Courses  du   samedi", amount: "-45.90", errors: [] };

  it("normalises whitespace so the same line compares equal to itself", () => {
    expect(importRowKey(row)).toBe("2026-10-05|Courses du samedi|-45.90");
    expect(importRowKey({ ...row, label: "Courses du samedi" })).toBe(importRowKey(row));
  });

  it("returns null for a row that cannot be imported", () => {
    expect(importRowKey({ ...row, errors: ["Date manquante."] })).toBeNull();
    expect(importRowKey({ ...row, date: null })).toBeNull();
    expect(importRowKey({ ...row, amount: null })).toBeNull();
  });
});

describe("importExternalRef", () => {
  it("keeps imported references namespaced away from internal ones", () => {
    expect(importExternalRef("REF-1")).toBe("import:REF-1");
  });

  it("parses amounts exactly, never through a float", () => {
    expect(parseImportAmount("0,10").plus(parseImportAmount("0,20")).toFixed(2)).toBe("0.30");
    expect(parseImportAmount("123456789,12") instanceof Decimal).toBe(true);
  });
});
