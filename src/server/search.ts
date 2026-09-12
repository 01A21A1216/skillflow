import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * Full-text search (§22).
 *
 * Every free-text filter in the application was `lower(column) like '%term%'`
 * across several columns. That is correct and, at 1,300 candidates, fast — and
 * it is a sequential scan that no index can help, because a leading wildcard
 * defeats a B-tree. At a hundred thousand candidates it is the slowest thing
 * in the product.
 *
 * The replacement is Postgres's own full-text search over a stored, generated
 * `tsvector` column with a GIN index. Generated rather than maintained by a
 * trigger or by the application: the column is a pure function of the row, so
 * Postgres keeps it in step and there is no path by which a write can forget
 * to update the index.
 *
 * ## Two things this changes, deliberately
 *
 * **It stops matching mid-word.** `like '%gine%'` finds "Engineer"; a lexeme
 * search does not. That is not a regression anyone will notice — people search
 * for the start of a word, not the middle of one — and the trade is that the
 * search becomes stemmed, so "managing" finds "manager".
 *
 * **It starts ranking.** `like` has no notion of a better match, so results
 * came back in whatever order the table was scanned. Weighted vectors mean a
 * candidate whose *name* matches now outranks one whose summary mentions the
 * word in passing, which is what somebody typing a name actually wants.
 */

/*
 * ## The weights
 *
 * Postgres allows exactly four, and the vector expressions live in
 * `db/schema.ts` because a generated column takes literal SQL. What each band
 * means is the decision worth recording here:
 *
 *   A  what the record *is* — a person's name, a requirement's title and code
 *   B  the strongest secondary identifiers — employer, skills, department
 *   C  context worth finding on that must never outrank a name — location,
 *      email, tags
 *   D  long prose, where a word appearing proves very little
 */

/* ------------------------------------------------------------------ *
 * Turning what somebody typed into a query
 * ------------------------------------------------------------------ */

/**
 * Characters `to_tsquery` treats as operators. A recruiter typing "C++" or
 * "AT&T" is not writing a boolean expression, and letting those through is
 * both a crash and, with `:` and `!`, a small injection surface.
 */
const OPERATORS = /[&|!():*<>'"\\]/g;

/**
 * A search term as a `tsquery`.
 *
 * Every token is ANDed, and the *last* one is a prefix match. That pairing is
 * what makes a search box feel right while somebody is still typing: "sarah
 * ora" should find Sarah on the Oracle desk before she has finished the word,
 * but should not match every Sarah in the database.
 *
 * Returns null when nothing usable is left, so callers can skip the condition
 * rather than search for an empty string — which matches everything.
 *
 * Split from `toTsQuery` because the string is where all the decisions are,
 * and a test of a string is a test of the decisions rather than of Drizzle's
 * internal representation of a fragment.
 */
export function tsQueryString(term: string): string | null {
  const tokens = term
    .replace(OPERATORS, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (!tokens.length) return null;

  return tokens
    .map((token, i) => (i === tokens.length - 1 ? `${token}:*` : token))
    .join(" & ");
}

export function toTsQuery(term: string): SQL | null {
  const query = tsQueryString(term);
  if (query === null) return null;

  // Passed as a parameter, never interpolated: the sanitising above removes
  // the operators, and this makes it structurally impossible for anything it
  // missed to be parsed as one.
  return sql`to_tsquery('english', ${query})`;
}

/**
 * `column @@ query`.
 *
 * Null when nothing was typed, so the caller adds no condition at all. But a
 * term that *was* typed and survives sanitising with nothing left — "!!!",
 * ":*" — matches nothing rather than everything. Falling through to "no
 * filter" there would answer a search with the whole table, which reads as
 * every row being a match.
 */
export function matches(column: SQL | unknown, term: string): SQL | null {
  if (!term.trim()) return null;
  const query = toTsQuery(term);
  if (!query) return sql`false`;
  return sql`${column} @@ ${query}`;
}

/** Whether a term will match nothing however it is applied. */
export function isUnsearchable(term: string) {
  return term.trim().length > 0 && tsQueryString(term) === null;
}

/**
 * Relevance, for ordering.
 *
 * `ts_rank`, not `ts_rank_cd`, and that is a measured choice rather than a
 * default. `ts_rank_cd` is the better ranking on paper — it accounts for how
 * close the matched words are — but it walks the position lists of every
 * matching row before anything can be sorted. Against 200,000 rows with
 * 33,000 matches it took **1,107ms** where `ts_rank` took **23ms** and no
 * ranking at all took 20ms.
 *
 * Fifty times the cost for a proximity refinement, on a query somebody types
 * a character at a time, is not a trade worth making — particularly when the
 * weights are already doing the work that matters. `ts_rank` honours them, so
 * a name match still outranks a mention in a summary.
 */
export function rank(column: SQL | unknown, term: string): SQL | null {
  const query = toTsQuery(term);
  if (!query) return null;
  return sql`ts_rank(${column}, ${query})`;
}
