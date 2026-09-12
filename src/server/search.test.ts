import { describe, expect, it } from "vitest";

import { isUnsearchable, matches, toTsQuery, tsQueryString } from "./search";

/**
 * What a search box does with what people actually type.
 *
 * The SQL is checked by the query plan; what needs pinning here is the string
 * handling, because every failure mode is silent. A stray `!` becomes a NOT
 * and quietly inverts the search. An unterminated quote makes Postgres throw
 * on a keystroke. A term that sanitises down to nothing falls through to no
 * filter and answers a search with the entire table.
 */

const queryText = tsQueryString;

describe("toTsQuery", () => {
  it("ANDs the words and prefixes the last one", () => {
    // The last token is a prefix because somebody is probably still typing it.
    expect(queryText("oracle dba")).toBe("oracle & dba:*");
    expect(queryText("senior oracle dba")).toBe("senior & oracle & dba:*");
  });

  it("prefixes a single word too", () => {
    expect(queryText("sel")).toBe("sel:*");
  });

  it("collapses whitespace rather than producing empty tokens", () => {
    expect(queryText("  oracle   dba  ")).toBe("oracle & dba:*");
  });

  it("strips the characters tsquery would read as operators", () => {
    // `+` is not one of them — Postgres lexes "C++" down to 'c' on its own,
    // so it is left alone rather than mangled here.
    expect(queryText("C++")).toBe("C++:*");
    // `&` is, and would otherwise turn a company name into a conjunction by
    // accident. Stripped to whitespace, it becomes an ordinary two-word search.
    expect(queryText("AT&T")).toBe("AT & T:*");
    // A `!` would become NOT and silently invert the search.
    expect(queryText("!senior")).toBe("senior:*");
    expect(queryText("foo | bar")).toBe("foo & bar:*");
  });

  it("cannot be made to inject a tsquery operator", () => {
    const nasty = `'); drop table candidates; --`;
    const text = queryText(nasty) as string;
    for (const operator of ["&", "|", "!", "(", ")", "'", '"', "\\", "<", ">"]) {
      expect(text.replace(/ & /g, " "), operator).not.toContain(operator);
    }
  });

  it("returns null when there is nothing to search for", () => {
    expect(toTsQuery("")).toBeNull();
    expect(toTsQuery("   ")).toBeNull();
    expect(toTsQuery("!!!")).toBeNull();
  });
});

describe("matches", () => {
  const column = { fake: true };

  it("adds no condition when nothing was typed", () => {
    expect(matches(column, "")).toBeNull();
    expect(matches(column, "   ")).toBeNull();
  });

  it("matches nothing when what was typed sanitises away", () => {
    // Not null: the alternative is answering a search with the whole table,
    // which reads as every row being a match.
    expect(matches(column, ":*!()")).not.toBeNull();
    expect(isUnsearchable(":*!()")).toBe(true);
    expect(isUnsearchable("")).toBe(false);
    expect(isUnsearchable("oracle")).toBe(false);
  });

  it("builds a condition for a real term", () => {
    expect(matches(column, "oracle")).not.toBeNull();
  });
});
