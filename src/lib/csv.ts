/**
 * CSV export helpers.
 *
 * Exports are the only way out of the dashboard, so they must stay readable by
 * a spreadsheet without becoming a security risk: a value starting with `=`,
 * `+`, `-` or `@` is interpreted as a formula by Excel and LibreOffice.
 */

export type CsvColumn<Row> = {
  key: keyof Row & string;
  header: string;
};

const FORMULA_TRIGGERS = ["=", "+", "@", "\t", "\r"];

function looksLikeNumber(value: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(value);
}

/**
 * Normalises a value and defuses spreadsheet formula injection.
 *
 * Numeric strings are left untouched, otherwise a negative amount such as
 * `-45,90` would be neutralised. Other values that begin with a formula trigger
 * are prefixed with an apostrophe.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = value instanceof Date ? value.toISOString() : String(value);

  const guarded =
    !looksLikeNumber(text) && FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))
      ? `'${text}`
      : text;

  const mustQuote = /[",;\n\r]/.test(guarded) || guarded !== guarded.trim();

  return mustQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(","),
  );

  return [header, ...lines].join("\r\n");
}

/**
 * Builds a downloadable CSV response.
 *
 * The UTF-8 BOM keeps accents readable when the file is opened directly in
 * Excel; bank and spreadsheet tools that dislike it can strip it.
 */
export function createCsvResponse(
  csv: string,
  fileName: string,
): Response {
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // Personal financial data: never cache an export in a shared proxy.
      "Cache-Control": "no-store",
    },
  });
}
