/**
 * Reading a query string, safely.
 *
 * `searchParams` gives `string | string[] | undefined`: a repeated parameter arrives as
 * an array, and an empty value as "". Both are treated as "not provided" here, so a
 * caller never has to guess what `?repo=` (empty) or `?repo=a&repo=b` means — it simply
 * means no filter, rather than a filter matching nothing.
 */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

export function readSearchParam(
  params: SearchParamsInput,
  key: string,
): string | undefined {
  const value = params[key];

  return typeof value === "string" && value !== "" ? value : undefined;
}
