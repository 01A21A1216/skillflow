import { describe, expect, it } from "vitest";

import { REPORTS, toCsv } from "./reports";

/**
 * The CSV writer.
 *
 * Worth pinning because every failure mode here is silent: a comma inside a
 * client name shifts every subsequent column, an unescaped quote swallows the
 * rest of the row, and a formula injection runs on the machine of whoever
 * opens the file. None of it is visible until the file is already somewhere
 * else.
 */

describe("toCsv", () => {
  it("writes a header and one line per row, CRLF separated", () => {
    const csv = toCsv(["Stage", "Count"], [["New", 12], ["Screening", 8]]);
    expect(csv).toBe("Stage,Count\r\nNew,12\r\nScreening,8");
  });

  it("quotes a field containing a comma, so the columns do not shift", () => {
    expect(toCsv(["Client"], [["Northgate Financial, Inc."]])).toContain(
      '"Northgate Financial, Inc."',
    );
  });

  it("doubles an embedded quote rather than ending the field early", () => {
    const csv = toCsv(["Note"], [['He said "no thanks"']]);
    expect(csv).toBe('Note\r\n"He said ""no thanks"""');
  });

  it("quotes a field containing a newline, so one row stays one row", () => {
    const csv = toCsv(["Reason"], [["Compensation\nmisaligned"]]);
    expect(csv).toBe('Reason\r\n"Compensation\nmisaligned"');
    // Header plus one logical row, even though the file has two physical lines.
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("writes an empty cell for null rather than the word null", () => {
    expect(toCsv(["A", "B"], [[null, 3]])).toBe("A,B\r\n,3");
  });

  /**
   * Formula injection. A candidate called `=cmd|'/c calc'!A1` is a plausible
   * thing for an attacker to type into a form, and Excel executes it on open.
   */
  it("defuses a cell that would be read as a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const csv = toCsv(["Name"], [[dangerous]]);
      expect(csv.split("\r\n")[1]!.startsWith("'")).toBe(true);
    }
  });

  it("still quotes a defused cell that also contains a comma", () => {
    const csv = toCsv(["Name"], [["=HYPERLINK(1,2)"]]);
    expect(csv).toBe(`Name\r\n"'=HYPERLINK(1,2)"`);
  });

  it("leaves an ordinary negative number alone in substance", () => {
    // It is prefixed, because a leading minus is indistinguishable from a
    // formula to Excel — but the value a reader sees is unchanged.
    const csv = toCsv(["Delta"], [[-4]]);
    expect(csv).toBe("Delta\r\n'-4");
  });

  it("handles a report with no rows", () => {
    expect(toCsv(["Stage", "Count"], [])).toBe("Stage,Count");
  });
});

describe("the report catalogue", () => {
  it("gives every report a unique key", () => {
    const keys = REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every report a heading for each column it will emit", () => {
    for (const r of REPORTS) {
      expect(r.columns.length, `${r.key} has no columns`).toBeGreaterThan(0);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it("uses url-safe keys, since they become a route segment", () => {
    for (const r of REPORTS) expect(r.key).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
