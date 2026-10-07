import Decimal from "decimal.js";
import { z } from "zod";
import { InvalidDateError, parseDateOnly } from "@/lib/dates";
import { InvalidAmountError, parseAmountInput } from "@/lib/money";
import { amount, optionalText, requiredDate } from "@/lib/validation";

/**
 * CSV import of bank statements (manual, never automatic — see AGENTS.md).
 *
 * The file never leaves the browser: the import page parses it locally with the pure
 * helpers below, shows a preview, and submits only the normalised rows to the Server
 * Action, which validates every field again. No dependency is added: the parser handles
 * the RFC 4180 essentials (quoted fields, escaped quotes, CR/LF) on its own.
 *
 * Rules, documented once here:
 * - **Date** formats: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD/MM/YY` (→ 20YY), and the same with
 *   `.` or `-` separators. A row whose date cannot be read is an error, never a guess.
 * - **Amount**: a `Montant` column (signed), or a `Débit` and a `Crédit` pair
 *   (`credit − debit`, blanks count as zero). Accounting parentheses `(45,90)` mean a
 *   negative amount. Zero is refused: it has nothing to record.
 * - **Type**: the sign decides — a negative amount is an `EXPENSE`, a positive one an
 *   `INCOME`. Imports never create transfers.
 * - **Duplicates**: identical means same operation date, same label (whitespace
 *   collapsed) and same amount. The check runs against the account's existing rows and
 *   within the file itself, and only when the owner asks for it.
 * - **References**: a mapped reference column becomes `externalRef = import:{ref}`, so
 *   re-importing the same export keeps skipping the same lines even after an edit that
 *   changed the label.
 */

export const IMPORT_ROW_LIMIT = 2000;
export const IMPORT_LABEL_MAX = 200;
export const IMPORT_NOTES_MAX = 2000;
export const IMPORT_REF_MAX = 120;
/** Bound of the duplicate check: an account holding more rows than this in the import's
 * date span cannot be checked honestly, and the import is refused rather than guessed. */
export const IMPORT_SCAN_LIMIT = 20_000;
export const IMPORT_REF_PREFIX = "import:";

/** Delimiters tried, in the order French exports usually use. */
export const DELIMITER_CANDIDATES = [";", ",", "\t", "|"] as const;

/**
 * The delimiter of a sample, as the candidate seen most often outside quotes on the
 * first non-empty line. Semicolon wins ties (French exports).
 */
export function detectDelimiter(sample: string): string {
  const firstLine = firstMeaningfulLine(sample);
  if (firstLine === null) {
    return ";";
  }

  let best = ";";
  let bestCount = 0;

  for (const candidate of DELIMITER_CANDIDATES) {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];

      if (char === '"') {
        if (inQuotes && firstLine[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && char === candidate) {
        count += 1;
      }
    }

    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function firstMeaningfulLine(sample: string): string | null {
  for (const line of sample.split(/\r\n|\n|\r/)) {
    if (line.trim() !== "") {
      return line;
    }
  }

  return null;
}

/**
 * Parses CSV text into a table of cells. Quotes protect delimiters and line breaks;
 * a doubled quote inside a quoted field is one quote. A BOM is stripped.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const flushRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      flushRow();
    } else if (char === "\r") {
      if (source[index + 1] === "\n") {
        // The \n branch flushes the row.
      } else {
        flushRow();
      }
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    flushRow();
  }

  return rows;
}

/**
 * An amount as bank exports write it. Reuses the project's amount parser (comma or dot
 * decimals, spaces, currency symbols) and adds the accounting parenthesis form.
 */
export function parseImportAmount(raw: string): Decimal {
  const trimmed = raw.trim();

  if (trimmed === "") {
    throw new InvalidAmountError(raw, "empty");
  }

  const parenthesised = /^\((.*)\)$/.exec(trimmed);
  if (parenthesised) {
    return parseAmountInput(parenthesised[1]).negated();
  }

  return parseAmountInput(trimmed);
}

const FRENCH_DATE_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

/**
 * A date as bank exports write it: `YYYY-MM-DD`, or day-first French forms
 * (`15/10/2026`, `15-10-2026`, `15.10.2026`, `15/10/26` → 2026). Month-first forms are
 * deliberately not guessed: `05/06` would silently become the wrong day in half the
 * cases.
 */
export function parseImportDate(raw: string): Date {
  const trimmed = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseDateOnly(trimmed);
  }

  const match = FRENCH_DATE_PATTERN.exec(trimmed);
  if (!match) {
    throw new InvalidDateError(raw);
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Re-validates through the shared parser so impossible days (31/02) are refused.
  return parseDateOnly(iso);
}

/* Column mapping. */

export const IMPORT_TARGETS = [
  "ignore",
  "date",
  "label",
  "amount",
  "debit",
  "credit",
  "reference",
  "category",
  "notes",
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  ignore: "Ignorer",
  date: "Date",
  label: "Libellé",
  amount: "Montant",
  debit: "Débit",
  credit: "Crédit",
  reference: "Référence",
  category: "Catégorie",
  notes: "Notes",
};

export type ImportMapping = {
  date: number | null;
  label: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  reference: number | null;
  category: number | null;
  notes: number | null;
};

export function emptyMapping(): ImportMapping {
  return {
    date: null,
    label: null,
    amount: null,
    debit: null,
    credit: null,
    reference: null,
    category: null,
    notes: null,
  };
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * A best-effort mapping from a header row: French and English bank column names.
 * Every guess is visible and editable in the UI — nothing is imported on a guess.
 */
export function guessMapping(header: readonly string[]): ImportMapping {
  const mapping = emptyMapping();
  const taken = new Set<number>();

  const assign = (target: keyof ImportMapping, predicate: (name: string) => boolean) => {
    if (mapping[target] !== null) {
      return;
    }

    for (let index = 0; index < header.length; index += 1) {
      if (taken.has(index)) {
        continue;
      }

      if (predicate(normalizeHeader(header[index]))) {
        mapping[target] = index;
        taken.add(index);
        return;
      }
    }
  };

  assign("date", (name) => name.includes("date"));
  assign("label", (name) => /libell|intitul|description|label/.test(name));
  assign("amount", (name) => /montant|amount|value/.test(name));
  assign("debit", (name) => name.includes("debit"));
  assign("credit", (name) => name.includes("credit"));
  assign("reference", (name) => /reference|ref\b|ref$|id ?operation/.test(name));
  assign("category", (name) => name.includes("categor") || name.includes("category"));
  assign("notes", (name) => /note|comment|memo/.test(name));

  return mapping;
}

/** Why the mapping cannot be submitted yet, as French sentences; empty means complete. */
export function missingMappingReasons(mapping: ImportMapping): string[] {
  const reasons: string[] = [];

  if (mapping.date === null) {
    reasons.push("Associez une colonne « Date ».");
  }
  if (mapping.label === null) {
    reasons.push("Associez une colonne « Libellé ».");
  }
  if (mapping.amount === null && mapping.debit === null && mapping.credit === null) {
    reasons.push("Associez une colonne « Montant », ou au moins une colonne « Débit » / « Crédit ».");
  }

  return reasons;
}

/* Parsed rows. */

export type ImportRow = {
  /** 1-based line number in the file, header included — what the owner can look up. */
  line: number;
  /** `YYYY-MM-DD`, or null when the date could not be read. */
  date: string | null;
  label: string;
  /** Exact signed decimal string (`-45.90`), or null when unreadable. */
  amount: string | null;
  reference: string | null;
  categoryName: string | null;
  notes: string | null;
  /** French messages; a row with errors is never submitted. */
  errors: string[];
  /** True when the label exceeded 200 characters and was cut to fit. */
  labelTruncated: boolean;
};

export type ImportBuild = {
  rows: ImportRow[];
  /** Data lines read (blank lines skipped), capped at `IMPORT_ROW_LIMIT`. */
  dataLineCount: number;
  /** True when the file holds more lines than the limit allows. */
  truncated: boolean;
  labelTruncatedCount: number;
};

function cell(row: readonly string[], index: number | null): string {
  if (index === null) {
    return "";
  }

  return (row[index] ?? "").trim();
}

export function buildImportRows(input: {
  table: readonly (readonly string[])[];
  mapping: ImportMapping;
  hasHeader: boolean;
}): ImportBuild {
  const start = input.hasHeader ? 1 : 0;
  const rows: ImportRow[] = [];
  let dataLineCount = 0;
  let truncated = false;
  let labelTruncatedCount = 0;

  for (let index = start; index < input.table.length; index += 1) {
    const source = input.table[index];

    if (source.every((value) => value.trim() === "")) {
      continue;
    }

    if (rows.length >= IMPORT_ROW_LIMIT) {
      truncated = true;
      break;
    }

    dataLineCount += 1;
    const errors: string[] = [];
    const rawDate = cell(source, input.mapping.date);
    const rawLabel = cell(source, input.mapping.label);

    let date: string | null = null;
    if (rawDate === "") {
      errors.push("Date manquante.");
    } else {
      try {
        date = parseImportDate(rawDate).toISOString().slice(0, 10);
      } catch {
        errors.push(`Date illisible « ${rawDate} ».`);
      }
    }

    let label = rawLabel;
    let labelTruncated = false;
    if (label === "") {
      errors.push("Libellé manquant.");
    } else if (label.length > IMPORT_LABEL_MAX) {
      label = label.slice(0, IMPORT_LABEL_MAX);
      labelTruncated = true;
      labelTruncatedCount += 1;
    }

    let amount: string | null = null;
    if (input.mapping.amount !== null) {
      const rawAmount = cell(source, input.mapping.amount);

      if (rawAmount === "") {
        errors.push("Montant manquant.");
      } else {
        try {
          amount = parseImportAmount(rawAmount).toFixed(2);
        } catch {
          errors.push(`Montant illisible « ${rawAmount} ».`);
        }
      }
    } else {
      const rawDebit = cell(source, input.mapping.debit);
      const rawCredit = cell(source, input.mapping.credit);

      if (rawDebit === "" && rawCredit === "") {
        errors.push("Montant manquant (débit et crédit vides).");
      } else {
        try {
          const debit = rawDebit === "" ? new Decimal(0) : parseImportAmount(rawDebit);
          const credit = rawCredit === "" ? new Decimal(0) : parseImportAmount(rawCredit);
          amount = credit.minus(debit).toFixed(2);
        } catch {
          errors.push(
            `Montant illisible (« ${rawDebit === "" ? "—" : rawDebit} » débit, « ${rawCredit === "" ? "—" : rawCredit} » crédit).`,
          );
        }
      }
    }

    if (amount !== null && new Decimal(amount).isZero()) {
      errors.push("Montant nul : cette ligne n'a rien à enregistrer.");
      amount = null;
    }

    const rawNotes = cell(source, input.mapping.notes);

    rows.push({
      line: index + 1,
      date,
      label,
      amount,
      reference: cell(source, input.mapping.reference) || null,
      categoryName: cell(source, input.mapping.category) || null,
      notes: rawNotes === "" ? null : rawNotes.slice(0, IMPORT_NOTES_MAX),
      errors,
      labelTruncated,
    });
  }

  return { rows, dataLineCount, truncated, labelTruncatedCount };
}

/**
 * Identity used for duplicate detection: date + label (whitespace collapsed) + amount.
 * Returns null for a row holding errors — an unreadable row can never be a duplicate.
 */
export function importRowKey(
  row: Pick<ImportRow, "date" | "label" | "amount" | "errors">,
): string | null {
  if (row.errors.length > 0 || row.date === null || row.amount === null) {
    return null;
  }

  const normalizedLabel = row.label.replace(/\s+/g, " ").trim();
  return `${row.date}|${normalizedLabel}|${row.amount}`;
}

/** The `externalRef` of an imported row; the prefix keeps the internal namespace clear. */
export function importExternalRef(reference: string): string {
  return `${IMPORT_REF_PREFIX}${reference}`;
}

/* Server contract: what the browser submits after the preview. */

export const importRowSubmissionSchema = z.object({
  date: requiredDate,
  label: z
    .string()
    .trim()
    .min(1, "Libellé manquant.")
    .max(IMPORT_LABEL_MAX, `Le libellé est limité à ${IMPORT_LABEL_MAX} caractères.`),
  amount: amount.refine(
    (value) => !value.isZero(),
    "Un montant nul n'a rien à importer.",
  ),
  reference: optionalText(IMPORT_REF_MAX, `La référence est limitée à ${IMPORT_REF_MAX} caractères.`),
  categoryName: optionalText(120, "Le nom de catégorie est limité à 120 caractères."),
  notes: optionalText(IMPORT_NOTES_MAX, `Les notes sont limitées à ${IMPORT_NOTES_MAX} caractères.`),
});

export type ImportRowSubmission = z.output<typeof importRowSubmissionSchema>;

export const importSubmissionSchema = z.object({
  accountId: z.string().trim().min(1, "Un compte est requis."),
  skipDuplicates: z.enum(["true", "false"]).transform((value) => value === "true"),
  rows: z
    .array(importRowSubmissionSchema)
    .min(1, "Aucune ligne à importer.")
    .max(IMPORT_ROW_LIMIT, `Un import est limité à ${IMPORT_ROW_LIMIT} lignes.`),
});

export type ImportSubmission = z.input<typeof importSubmissionSchema>;
export type ValidatedImportSubmission = z.output<typeof importSubmissionSchema>;

/** What the import actually did — counts only, never amounts. */
export type ImportSummary = {
  received: number;
  imported: number;
  duplicatesSkipped: number;
  /** Rows whose category name matched nothing: imported, category left empty. */
  unknownCategories: number;
};

/**
 * Result contract of the import action.
 *
 * Deliberately its own shape rather than the shared `ActionResult`: an import answers
 * with a summary (counters), which the other actions never carry.
 */
export type ImportActionResult =
  | { status: "ok"; summary: ImportSummary }
  | { status: "invalid"; message: string; fieldErrors: Record<string, string[]> }
  | { status: "error"; message: string };
