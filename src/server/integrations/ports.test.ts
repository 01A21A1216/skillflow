import { describe, expect, it } from "vitest";

import { calendarEventFor, type InterviewDetail } from "./outbound";
import { calendar, email, integrationStatus, jobBoard } from "./ports";

/**
 * The integration seam.
 *
 * Two things are worth holding still here. The defaults must decline rather
 * than pretend — a port that reported success while sending nothing would let
 * an interview sit in nobody's calendar with no trace of why. And the calendar
 * payload has to keep the candidate off an internal invite, which is a privacy
 * decision, not a formatting one.
 */

const detail = (over: Partial<InterviewDetail> = {}): InterviewDetail =>
  ({
    interview: {
      id: "ivw_1",
      title: "Technical Round 1",
      type: "technical",
      round: 1,
      scheduledAt: new Date("2026-09-20T14:00:00Z"),
      endsAt: new Date("2026-09-20T15:00:00Z"),
      timezone: "America/New_York",
      locationOrLink: "https://meet.example/abc",
      agenda: "Oracle RAC deep dive",
      updatedAt: new Date("2026-09-11T09:00:00Z"),
      calendarEventId: null,
    },
    candidate: { firstName: "Asha", lastName: "Raman", email: "asha@example.com" },
    requisition: { code: "REQ-1042", title: "Senior Oracle DBA" },
    organiser: { email: "lead@agency.example" },
    panelEmails: ["panel1@agency.example", "panel2@agency.example"],
    ...over,
  }) as InterviewDetail;

describe("no provider is configured", () => {
  it("declines rather than reporting a phantom success", async () => {
    const results = [
      await calendar().create(calendarEventFor(detail())),
      await calendar().cancel("x", "why"),
      await email().send({ idempotencyKey: "k", to: ["a@b.c"], subject: "s", body: "b" }),
      await jobBoard().publish({
        idempotencyKey: "k",
        title: "t",
        description: "d",
        location: "Austin, TX",
        workMode: "hybrid",
        employmentType: "w2",
        salaryMin: null,
        salaryMax: null,
        skills: [],
      }),
    ];

    for (const result of results) {
      expect(result.sent).toBe(false);
      // A reason a person could act on, not a bare false.
      expect(result.reason).toMatch(/configured/);
      expect(result.externalId).toBeUndefined();
    }
  });

  it("reports itself on the settings screen", () => {
    const status = integrationStatus();
    expect(status.map((s) => s.key)).toEqual(["calendar", "email", "job_board"]);
    expect(status.every((s) => s.provider === "none")).toBe(true);
    expect(status.every((s) => s.purpose.length > 20)).toBe(true);
  });
});

describe("calendarEventFor", () => {
  it("invites the panel and the organiser, never the candidate", () => {
    const event = calendarEventFor(detail());
    expect(event.attendeeEmails).toEqual(["panel1@agency.example", "panel2@agency.example"]);
    expect(event.attendeeEmails).not.toContain("asha@example.com");
    expect(event.organiserEmail).toBe("lead@agency.example");
  });

  it("de-duplicates a panelist who is also the organiser", () => {
    const event = calendarEventFor(
      detail({ panelEmails: ["lead@agency.example", "lead@agency.example"] }),
    );
    expect(event.attendeeEmails).toEqual(["lead@agency.example"]);
  });

  it("names the candidate and the requirement so a calendar entry is legible", () => {
    const event = calendarEventFor(detail());
    expect(event.title).toBe("Technical Round 1 — Asha Raman");
    expect(event.description).toContain("REQ-1042");
    expect(event.description).toContain("Round 1");
    expect(event.description).toContain("Oracle RAC deep dive");
  });

  it("omits an absent agenda rather than leaving a blank line", () => {
    const event = calendarEventFor(
      detail({ interview: { ...detail().interview, agenda: null } }),
    );
    expect(event.description.split("\n").every((line) => line.trim())).toBe(true);
  });

  it("changes its idempotency key when the round is rescheduled", () => {
    const first = calendarEventFor(detail());
    const rescheduled = calendarEventFor(
      detail({
        interview: {
          ...detail().interview,
          scheduledAt: new Date("2026-09-21T14:00:00Z"),
          updatedAt: new Date("2026-09-12T09:00:00Z"),
        },
      }),
    );

    expect(first.idempotencyKey).not.toBe(rescheduled.idempotencyKey);
    // …but re-sending the same unchanged round does not create a second event.
    expect(calendarEventFor(detail()).idempotencyKey).toBe(first.idempotencyKey);
  });

  it("carries the booked timezone, not just the instant", () => {
    const event = calendarEventFor(detail());
    expect(event.timezone).toBe("America/New_York");
    expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(3_600_000);
  });
});
