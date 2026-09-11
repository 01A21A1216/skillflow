/**
 * Deterministic seed generator.
 *
 * Rather than sprinkling random rows around, this simulates the recruiting
 * org running for ~11 months: requisitions open, candidates enter pipelines,
 * dwell in stages for plausible amounts of time, get interviewed, receive
 * feedback, and either convert to an offer or drop out for a real reason.
 * Every derived metric on the analytics pages therefore tells a coherent story.
 *
 * The key trick is that *live* submissions are generated backwards from today
 * (so stage ages, SLA breaches and upcoming interviews look like a real week)
 * while *closed* submissions are walked forwards through history.
 *
 *   npm run db:seed          # rebuild from scratch
 */

import crypto from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import * as s from "./schema";
import { PERMISSIONS, ROLES } from "../lib/permissions";
import {
  AGENDA_TEMPLATES,
  CANDIDATE_COMPANIES,
  CITIES,
  CLIENT_SEEDS,
  CONCERN_TEMPLATES,
  FIRST_NAMES,
  JOB_FAMILIES,
  LAST_NAMES,
  NOTE_TEMPLATES,
  STRENGTH_TEMPLATES,
  TEAM_SEEDS,
} from "./seed-data";

/* ------------------------------------------------------------------ *
 * Deterministic RNG
 * ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260911);

const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
const clampNum = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const sample = <T,>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < Math.min(n, copy.length)) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]!);
  }
  return out;
};
/** Weighted choice: entries are [value, weight]. */
const weighted = <T,>(entries: [T, number][]): T => {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1]![0];
};

const DAY = 86_400_000;
const NOW = new Date("2026-09-11T17:00:00Z").getTime();
const daysAgo = (d: number) => NOW - d * DAY;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Nudge a timestamp onto a plausible weekday working hour. */
function businessMoment(ms: number, hourMin = 9, hourMax = 17) {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(int(hourMin, hourMax), pick([0, 15, 30, 45]), 0, 0);
  return d.getTime();
}

let counter = 0;
const id = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(5, "0")}`;

/* ------------------------------------------------------------------ *
 * Rows under construction
 * ------------------------------------------------------------------ */

const users: (typeof s.users.$inferInsert)[] = [];
const clients: (typeof s.clients.$inferInsert)[] = [];
const requisitions: (typeof s.requisitions.$inferInsert)[] = [];
const reqAssignees: (typeof s.requisitionAssignees.$inferInsert)[] = [];
const candidates: (typeof s.candidates.$inferInsert)[] = [];
const submissions: (typeof s.submissions.$inferInsert)[] = [];
const stageEvents: (typeof s.stageEvents.$inferInsert)[] = [];
const interviews: (typeof s.interviews.$inferInsert)[] = [];
const panels: (typeof s.interviewPanel.$inferInsert)[] = [];
const feedbacks: (typeof s.feedback.$inferInsert)[] = [];
const offers: (typeof s.offers.$inferInsert)[] = [];
const notes: (typeof s.notes.$inferInsert)[] = [];
const activities: (typeof s.activities.$inferInsert)[] = [];

function activity(
  entityType: string,
  entityId: string,
  type: string,
  actorId: string | null,
  summary: string,
  createdAt: number,
  meta?: Record<string, unknown>,
) {
  activities.push({
    id: id("act"),
    entityType,
    entityId,
    type,
    actorId,
    summary,
    meta: meta ?? null,
    createdAt: new Date(Math.min(createdAt, NOW)),
  });
}

/* ------------------------------------------------------------------ *
 * 1. Team
 * ------------------------------------------------------------------ */

const ACCENTS = ["indigo", "violet", "blue", "cyan", "emerald", "amber", "orange", "rose"];

/**
 * The seed file describes the org in plain job terms; the access model uses the
 * seven roles from the specification. Coordinators map onto `recruiter`
 * because scheduling and pipeline work need the same permissions — their job
 * title still reads "Recruiting Coordinator" in the UI.
 */
const ROLE_FOR_SEED: Record<string, string> = {
  admin: "super_admin",
  recruiter: "recruiter",
  coordinator: "recruiter",
  hiring_manager: "hiring_manager",
  interviewer: "interviewer",
};

/** Named people who get a more specific role than their seed category implies. */
const ROLE_OVERRIDES: Record<string, string> = {
  "Marcus Ellery": "recruitment_manager",
  "Tobias Lindqvist": "sourcer",
  "Dana Whitfield": "super_admin",
};

/**
 * Demo password for every seeded account. Development convenience only — the
 * login page surfaces it outside production and nowhere else.
 */
const DEMO_PASSWORD = "demo1234";

/** scrypt, matching src/server/auth.ts. Hashed once and reused for all demo users. */
function hashDemoPassword() {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(DEMO_PASSWORD, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64"), derived.toString("base64")].join("$");
}
const DEMO_HASH = hashDemoPassword();

for (const seed of TEAM_SEEDS) {
  const [first, last] = seed.name.split(" ");
  const joined = daysAgo(int(120, 2400));
  users.push({
    id: id("usr"),
    name: seed.name,
    email: `${first!.toLowerCase()}.${last!.toLowerCase()}@meridiantalent.com`,
    role: ROLE_OVERRIDES[seed.name] ?? ROLE_FOR_SEED[seed.role] ?? "recruiter",
    passwordHash: DEMO_HASH,
    title: seed.title,
    department: seed.department,
    phone: `+1 (${int(201, 989)}) ${int(200, 999)}-${int(1000, 9999)}`,
    timezone: pick(CITIES).tz,
    accent: pick(ACCENTS),
    capacity: seed.capacity,
    active: true,
    joinedAt: isoDay(joined),
    createdAt: new Date(joined),
  });
}

users.push({
  id: id("usr"),
  name: "Helena Voss",
  email: "helena.voss@meridiantalent.com",
  role: "readonly_management",
  title: "Chief People Officer",
  department: "Executive",
  phone: `+1 (${int(201, 989)}) ${int(200, 999)}-${int(1000, 9999)}`,
  timezone: "America/New_York",
  accent: "violet",
  capacity: 0,
  active: true,
  joinedAt: isoDay(daysAgo(int(600, 2000))),
  passwordHash: DEMO_HASH,
  createdAt: new Date(daysAgo(int(600, 2000))),
});

const byRole = (role: string) => users.filter((u) => u.role === role);
const recruiters = byRole("recruiter");
const hiringManagers = byRole("hiring_manager");
/** Coordinators share the recruiter role; identify them by job title. */
const coordinators = users.filter((u) => u.title!.includes("Coordinator"));
const interviewerPool = [...byRole("interviewer"), ...hiringManagers];
const leadership = [...byRole("super_admin"), ...byRole("recruitment_manager")];

/* ------------------------------------------------------------------ *
 * 2. Clients
 * ------------------------------------------------------------------ */

for (const c of CLIENT_SEEDS) {
  const owner = pick([...recruiters, ...leadership]);
  clients.push({
    id: id("cli"),
    name: c.name,
    industry: c.industry,
    location: c.location,
    tier: c.tier,
    accountOwnerId: owner.id!,
    contactName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    contactEmail: `talent@${c.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    status: "active",
    slaDays: c.tier === "strategic" ? 18 : c.tier === "key" ? 24 : 30,
    createdAt: new Date(daysAgo(int(400, 1600))),
  });
}

/* ------------------------------------------------------------------ *
 * 3. Requisitions
 * ------------------------------------------------------------------ */

const REQ_COUNT = 54;

interface ReqPlan {
  row: (typeof requisitions)[number];
  family: (typeof JOB_FAMILIES)[number];
  openedMs: number;
  ageDays: number;
  /** Decided up front so the pipeline can be generated to match. */
  status: "draft" | "open" | "on_hold" | "filled" | "cancelled";
}
const reqPlans: ReqPlan[] = [];

for (let i = 0; i < REQ_COUNT; i += 1) {
  const family = pick(JOB_FAMILIES);
  const titleSpec = pick(family.titles);
  const client = pick(clients);
  const hm = hiringManagers.find((h) => h.department === family.department) ?? pick(hiringManagers);
  const lead = pick(recruiters);

  const ageDays = int(3, 320);
  const openedMs = daysAgo(ageDays);
  const openings = weighted<number>([
    [1, 70],
    [2, 18],
    [3, 8],
    [4, 4],
  ]);

  // Old requisitions have mostly resolved; young ones are still running.
  const status: ReqPlan["status"] =
    ageDays < 7
      ? weighted([
          ["draft", 35],
          ["open", 65],
        ] as [ReqPlan["status"], number][])
      : ageDays > 150
        ? weighted([
            ["filled", 58],
            ["cancelled", 12],
            ["on_hold", 8],
            ["open", 22],
          ] as [ReqPlan["status"], number][])
        : weighted([
            ["open", 58],
            ["filled", 27],
            ["on_hold", 9],
            ["cancelled", 6],
          ] as [ReqPlan["status"], number][]);

  const priority = weighted([
    ["critical", 12],
    ["high", 30],
    ["medium", 42],
    ["low", 16],
  ] as [string, number][]);

  const employmentType = weighted([
    ["full_time", 74],
    ["contract", 13],
    ["contract_to_hire", 8],
    ["part_time", 3],
    ["intern", 2],
  ] as [string, number][]);

  const workMode = weighted([
    ["hybrid", 42],
    ["remote", 38],
    ["onsite", 20],
  ] as [string, number][]);

  const [baseMin, baseMax] = titleSpec.base;
  const locationSpec = workMode === "remote" ? { city: "Remote (US)" } : pick(CITIES);

  const row = {
    id: id("req"),
    code: `REQ-${new Date(openedMs).getUTCFullYear()}-${String(i + 1).padStart(3, "0")}`,
    title: titleSpec.title,
    clientId: client.id!,
    hiringManagerId: hm.id!,
    leadRecruiterId: lead.id!,
    department: family.department,
    employmentType,
    workMode,
    location: locationSpec.city,
    openings,
    filled: 0,
    priority,
    status: "open",
    seniority: titleSpec.seniority,
    minSalary: baseMin,
    maxSalary: baseMax,
    billRateMin: employmentType.startsWith("contract") ? Math.round(baseMin / 2000) + 12 : null,
    billRateMax: employmentType.startsWith("contract") ? Math.round(baseMax / 2000) + 22 : null,
    currency: "USD",
    experienceMin:
      titleSpec.seniority === "junior" ? 1 : titleSpec.seniority === "mid" ? 3 : titleSpec.seniority === "senior" ? 6 : 9,
    experienceMax:
      titleSpec.seniority === "junior" ? 3 : titleSpec.seniority === "mid" ? 6 : titleSpec.seniority === "senior" ? 10 : 18,
    skills: sample(family.skills, int(5, 7)),
    description: family.blurb,
    requirements: family.requirements,
    openedAt: isoDay(openedMs),
    targetFillDate: isoDay(openedMs + int(28, 75) * DAY),
    closedAt: null as string | null,
    createdAt: new Date(openedMs),
    updatedAt: new Date(openedMs),
  };

  requisitions.push(row);
  reqPlans.push({ row, family, openedMs, ageDays, status });

  // Coordinators now carry the recruiter role, so the same person can be drawn
  // twice for one requisition. The unique index enforces one row per member.
  const seen = new Set<string>();
  const addAssignee = (userId: string, role: string) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    reqAssignees.push({ id: id("ras"), requisitionId: row.id, userId, role });
  };

  addAssignee(lead.id!, "lead");
  for (const u of sample(recruiters.filter((r) => r.id !== lead.id), int(0, 2))) {
    addAssignee(u.id!, "support");
  }
  addAssignee(pick(coordinators).id!, "coordinator");

  activity(
    "requisition",
    row.id,
    "requisition_created",
    lead.id!,
    `Opened ${row.code} — ${row.title} for ${client.name}`,
    openedMs,
  );
}

/* ------------------------------------------------------------------ *
 * 4. Candidate factory
 * ------------------------------------------------------------------ */

const usedHandles = new Set<string>();

function makeCandidate(family: (typeof JOB_FAMILIES)[number], createdMs: number) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  let handle = `${firstName}.${lastName}`.toLowerCase();
  let suffix = 1;
  while (usedHandles.has(handle)) {
    suffix += 1;
    handle = `${firstName}.${lastName}${suffix}`.toLowerCase();
  }
  usedHandles.add(handle);

  const titleSpec = pick(family.titles);
  const years =
    titleSpec.seniority === "junior"
      ? int(1, 3)
      : titleSpec.seniority === "mid"
        ? int(3, 7)
        : titleSpec.seniority === "senior"
          ? int(6, 12)
          : int(10, 20);

  const source = weighted([
    ["linkedin", 24],
    ["sourced", 18],
    ["referral", 15],
    ["job_board", 13],
    ["career_site", 12],
    ["inbound", 8],
    ["agency", 5],
    ["event", 3],
    ["rehire", 2],
  ] as [string, number][]);

  const skills = sample(family.skills, int(4, 7));
  const company = pick(CANDIDATE_COMPANIES);
  const notice = pick([0, 14, 14, 21, 30, 30, 60]);
  const relocate = chance(0.32);

  const row = {
    id: id("cnd"),
    firstName,
    lastName,
    email: `${handle}@${pick(["mail.com", "proton.me", "outlook.com", "gmail.com", "fastmail.com"])}`,
    phone: `+1 (${int(201, 989)}) ${int(200, 999)}-${int(1000, 9999)}`,
    location: pick(CITIES).city,
    currentTitle: titleSpec.title,
    currentCompany: company,
    yearsExperience: years,
    seniority: titleSpec.seniority,
    skills,
    source,
    sourceDetail:
      source === "referral"
        ? `Referred by ${pick(users).name}`
        : source === "job_board"
          ? pick(["Indeed", "Dice", "Built In", "Otta"])
          : source === "event"
            ? pick(["QCon", "KubeCon", "Local meetup", "University career fair"])
            : source === "agency"
              ? pick(["Kestrel Search", "Bluewater Partners", "Ridgeline Talent"])
              : null,
    referredById: source === "referral" ? pick(users).id! : null,
    ownerId: pick(recruiters).id!,
    status: "active",
    expectedSalary: Math.round((titleSpec.base[0] * (1 + rand() * 0.28)) / 1000) * 1000,
    currentSalary: Math.round((titleSpec.base[0] * (0.82 + rand() * 0.22)) / 1000) * 1000,
    currency: "USD",
    noticePeriodDays: notice,
    workAuthorization: weighted([
      ["citizen", 68],
      ["permanent_resident", 14],
      ["visa_holder", 12],
      ["requires_sponsorship", 6],
    ] as [string, number][]),
    willingToRelocate: relocate,
    linkedinUrl: `https://linkedin.com/in/${handle.replace(/\./g, "-")}`,
    summary:
      `${titleSpec.title} with ${years} years of experience, currently at ${company}. ` +
      `Strongest in ${skills.slice(0, 3).join(", ")}. ` +
      (relocate ? "Open to relocation. " : "Prefers to stay in-market. ") +
      (notice ? `${notice}-day notice period.` : "Immediately available."),
    tags: sample(
      ["top-of-funnel", "silver-medalist", "referral", "diversity-slate", "boomerang", "passive", "urgent", "relocating"],
      int(0, 2),
    ),
    rating: weighted([
      [0, 16],
      [3, 26],
      [4, 39],
      [5, 19],
    ] as [number, number][]),
    lastContactedAt: new Date(Math.min(NOW, createdMs + int(0, 30) * DAY)),
    createdAt: new Date(createdMs),
    updatedAt: new Date(createdMs),
  };

  candidates.push(row);
  activity(
    "candidate",
    row.id,
    "candidate_created",
    row.ownerId,
    `Added ${firstName} ${lastName} to the talent pool`,
    createdMs,
  );
  return row;
}

/* ------------------------------------------------------------------ *
 * 5. Pipeline simulation
 * ------------------------------------------------------------------ */

const STAGES = ["sourced", "screening", "submitted", "interview", "offer", "hired"] as const;
type StageName = (typeof STAGES)[number];

/** Typical dwell time per stage, in days. */
const DWELL: Record<StageName, [number, number]> = {
  sourced: [1, 6],
  screening: [2, 8],
  submitted: [2, 9],
  interview: [5, 20],
  offer: [3, 12],
  hired: [0, 0],
};

/** How long a live submission has plausibly been sitting where it is. */
const LIVE_AGE: Record<StageName, [number, number]> = {
  sourced: [0, 7],
  screening: [0, 6],
  submitted: [1, 8],
  interview: [1, 15],
  offer: [1, 10],
  hired: [0, 0],
};

const REJECTION_BY_STAGE: Record<StageName, string[]> = {
  sourced: ["Skills mismatch", "Compensation misaligned", "Unresponsive", "Location or work-mode conflict"],
  screening: ["Insufficient experience", "Compensation misaligned", "Work authorization", "Skills mismatch"],
  submitted: ["Skills mismatch", "Insufficient experience", "Position filled by another candidate"],
  interview: ["Failed technical interview", "Culture / values fit", "Skills mismatch", "Unresponsive"],
  offer: ["Compensation misaligned", "Position filled by another candidate", "Candidate withdrew"],
  hired: [],
};

const INTERVIEW_LOOPS: Record<string, { type: string; title: string }[]> = {
  default: [
    { type: "phone_screen", title: "Recruiter screen" },
    { type: "hiring_manager", title: "Hiring manager conversation" },
    { type: "technical", title: "Craft deep dive" },
    { type: "panel", title: "Panel loop" },
    { type: "final", title: "Final round" },
  ],
  engineering: [
    { type: "phone_screen", title: "Recruiter screen" },
    { type: "technical", title: "Technical deep dive" },
    { type: "system_design", title: "System design" },
    { type: "hiring_manager", title: "Hiring manager conversation" },
    { type: "final", title: "Values and final round" },
  ],
  gtm: [
    { type: "phone_screen", title: "Recruiter screen" },
    { type: "hiring_manager", title: "Hiring manager conversation" },
    { type: "behavioral", title: "Discovery role play" },
    { type: "client", title: "Client stakeholder round" },
    { type: "final", title: "Executive final" },
  ],
};

function loopFor(department: string) {
  if (department === "Engineering" || department === "Security" || department === "Data & Analytics")
    return INTERVIEW_LOOPS.engineering!;
  if (department === "Go-to-Market") return INTERVIEW_LOOPS.gtm!;
  return INTERVIEW_LOOPS.default!;
}

interface SimContext {
  req: (typeof requisitions)[number];
  family: (typeof JOB_FAMILIES)[number];
  loop: { type: string; title: string }[];
  openedMs: number;
}

/**
 * Build one submission end to end: stage history, interviews, feedback,
 * offer and notes. `kind` decides how the timeline is anchored.
 */
function buildSubmission(
  ctx: SimContext,
  kind: "hired" | "live" | "closed",
  budget: { upcomingInterviews: number },
) {
  const { req, family, loop, openedMs } = ctx;

  const furthest =
    kind === "hired"
      ? 5
      : kind === "live"
        ? weighted([
            [0, 17],
            [1, 21],
            [2, 20],
            [3, 30],
            [4, 12],
          ] as [number, number][])
        : weighted([
            [0, 31],
            [1, 26],
            [2, 20],
            [3, 18],
            [4, 5],
          ] as [number, number][]);

  const stageName = STAGES[furthest]!;

  /* --- Anchor the timeline ------------------------------------- */
  const enteredAt: number[] = [];

  if (kind === "live") {
    // Work backwards from today so stage age and SLA breaches are realistic.
    const [ageLo, ageHi] = LIVE_AGE[stageName];
    let cursor = businessMoment(daysAgo(int(ageLo, ageHi)));
    enteredAt[furthest] = cursor;
    for (let st = furthest - 1; st >= 0; st -= 1) {
      const [lo, hi] = DWELL[STAGES[st]!];
      cursor -= int(lo, hi) * DAY;
      enteredAt[st] = businessMoment(Math.max(cursor, openedMs));
    }
  } else {
    // Walk forwards from somewhere inside the requisition's lifetime.
    const span = Math.max(1, Math.floor((NOW - openedMs) / DAY));
    let cursor = openedMs + int(0, Math.max(1, Math.floor(span * 0.6))) * DAY;
    for (let st = 0; st <= furthest; st += 1) {
      enteredAt[st] = businessMoment(Math.min(cursor, NOW - DAY));
      const [lo, hi] = DWELL[STAGES[st]!];
      cursor += int(lo, hi) * DAY;
    }
  }

  const candidate = makeCandidate(family, Math.max(openedMs - int(0, 25) * DAY, enteredAt[0]! - int(0, 40) * DAY));

  const hired = kind === "hired";
  const withdrew = kind === "closed" && chance(0.17);
  const status = hired ? "hired" : kind === "live" ? "active" : withdrew ? "withdrawn" : "rejected";
  const finalStage = hired ? "hired" : kind === "live" ? stageName : withdrew ? "withdrawn" : "rejected";

  const closedAt =
    kind === "closed"
      ? Math.min(NOW - int(0, 2) * DAY, enteredAt[furthest]! + int(1, 10) * DAY)
      : null;

  const submissionId = id("sub");
  const owner = req.leadRecruiterId!;
  const submittedAt = furthest >= 2 ? enteredAt[2]! : null;

  if (hired) candidate.status = "placed";
  else if (kind === "closed" && chance(0.08)) candidate.status = "passive";

  submissions.push({
    id: submissionId,
    candidateId: candidate.id,
    requisitionId: req.id,
    stage: finalStage,
    status,
    ownerId: owner,
    matchScore: clampNum(Math.round(58 + furthest * 5 + (candidate.rating ?? 0) * 3 + int(-11, 11)), 34, 98),
    expectedRate: req.billRateMin ? int(req.billRateMin, req.billRateMax ?? req.billRateMin + 20) : null,
    rejectionReason:
      status === "rejected"
        ? pick(REJECTION_BY_STAGE[stageName] ?? ["Skills mismatch"])
        : status === "withdrawn"
          ? "Candidate withdrew"
          : null,
    rejectedAt: closedAt ? new Date(closedAt) : null,
    submittedAt: submittedAt ? new Date(submittedAt) : null,
    stageSince: new Date(closedAt ?? enteredAt[furthest]!),
    createdAt: new Date(enteredAt[0]!),
    updatedAt: new Date(closedAt ?? enteredAt[furthest]!),
  });

  for (let st = 0; st <= furthest; st += 1) {
    stageEvents.push({
      id: id("stg"),
      submissionId,
      fromStage: st === 0 ? null : STAGES[st - 1]!,
      toStage: STAGES[st]!,
      actorId: owner,
      note: null,
      createdAt: new Date(enteredAt[st]!),
    });
  }
  if (closedAt) {
    stageEvents.push({
      id: id("stg"),
      submissionId,
      fromStage: stageName,
      toStage: withdrew ? "withdrawn" : "rejected",
      actorId: owner,
      note: withdrew ? "Candidate withdrew from the process" : "Closed out after review",
      createdAt: new Date(closedAt),
    });
  }

  const who = `${candidate.firstName} ${candidate.lastName}`;
  activity("submission", submissionId, "submission_created", owner, `${who} added to ${req.code}`, enteredAt[0]!, {
    requisitionId: req.id,
    candidateId: candidate.id,
  });
  if (submittedAt) {
    activity("submission", submissionId, "stage_changed", owner, `${who} submitted to ${req.title}`, submittedAt, {
      requisitionId: req.id,
      candidateId: candidate.id,
      stage: "submitted",
    });
  }
  if (closedAt) {
    activity(
      "submission",
      submissionId,
      "submission_rejected",
      owner,
      `${who} ${withdrew ? "withdrew from" : "was closed out of"} ${req.code}`,
      closedAt,
      { requisitionId: req.id, candidateId: candidate.id },
    );
  }

  /* --- Interviews ------------------------------------------------ */

  /** Create one interview round, its panel and (if it already happened) feedback. */
  function pushInterview(roundNumber: number, scheduledAt: number, forcePositive?: boolean) {
    const spec = loop[Math.min(roundNumber - 1, loop.length - 1)]!;
    const inFuture = scheduledAt > NOW;

    const ivStatus = inFuture
      ? "scheduled"
      : weighted([
          ["completed", 88],
          ["cancelled", 4],
          ["no_show", 3],
          ["rescheduled", 5],
        ] as [string, number][]);

    const positive = forcePositive ?? (hired || chance(kind === "live" ? 0.74 : 0.5));
    const outcome =
      ivStatus !== "completed"
        ? "pending"
        : positive
          ? weighted([
              ["strong_yes", 22],
              ["yes", 44],
              ["lean_yes", 34],
            ] as [string, number][])
          : weighted([
              ["lean_no", 38],
              ["no", 44],
              ["strong_no", 18],
            ] as [string, number][]);

    const organizer = pick(coordinators);
    const interviewId = id("ivw");
    const mode = weighted([
      ["video", 72],
      ["onsite", 18],
      ["phone", 10],
    ] as [string, number][]);

    const sameDept = interviewerPool.filter((u) => u.department === req.department);
    const panelSize = spec.type === "panel" ? int(3, 4) : spec.type === "phone_screen" ? 1 : int(1, 2);
    const panelists = sample(sameDept.length >= panelSize ? sameDept : interviewerPool, panelSize);

    interviews.push({
      id: interviewId,
      submissionId,
      round: roundNumber,
      title: spec.title,
      type: spec.type,
      mode,
      scheduledAt: new Date(scheduledAt),
      durationMinutes: spec.type === "panel" ? 180 : spec.type === "phone_screen" ? 30 : pick([45, 60, 60, 75]),
      locationOrLink:
        mode === "onsite"
          ? `${req.location} — Floor ${int(2, 14)}, ${pick(["Aspen", "Birch", "Cedar", "Dogwood", "Elm"])} Room`
          : mode === "phone"
            ? "Dial-in provided in the calendar invite"
            : `https://meet.meridiantalent.com/${interviewId.slice(-8)}`,
      status: ivStatus,
      outcome,
      organizerId: organizer.id!,
      agenda: pick(AGENDA_TEMPLATES),
      createdAt: new Date(Math.min(NOW, scheduledAt - int(2, 9) * DAY)),
      updatedAt: new Date(Math.min(NOW, scheduledAt)),
    });

    for (const [idx, p] of panelists.entries()) {
      panels.push({
        id: id("pnl"),
        interviewId,
        userId: p.id!,
        role: idx > 0 && chance(0.15) ? "shadow" : "interviewer",
      });
    }

    activity(
      "submission",
      submissionId,
      inFuture ? "interview_scheduled" : ivStatus === "cancelled" ? "interview_cancelled" : "interview_completed",
      organizer.id!,
      `${spec.title} ${inFuture ? "scheduled" : ivStatus} — ${who}`,
      inFuture ? Math.min(NOW, scheduledAt - 3 * DAY) : scheduledAt,
      { requisitionId: req.id, candidateId: candidate.id, interviewId },
    );

    if (ivStatus === "completed") {
      const ageDays = (NOW - scheduledAt) / DAY;
      // Outstanding feedback is a recent-weeks problem; older loops got chased.
      const skipRate = ageDays > 21 ? 0.015 : ageDays > 7 ? 0.12 : 0.3;

      for (const p of panelists) {
        if (chance(skipRate)) continue;
        const lean = outcome.includes("yes");
        const overall = lean ? int(3, 5) : int(1, 3);
        const jitter = () => clampNum(overall + int(-1, 1), 1, 5);
        const submittedMs = Math.min(NOW, businessMoment(scheduledAt + int(0, 3) * DAY, 9, 19));
        const recommendation = lean
          ? outcome === "strong_yes"
            ? "strong_hire"
            : outcome === "yes"
              ? "hire"
              : "lean_hire"
          : outcome === "lean_no"
            ? "lean_no_hire"
            : "no_hire";

        feedbacks.push({
          id: id("fbk"),
          interviewId,
          interviewerId: p.id!,
          recommendation,
          overall,
          technical: jitter(),
          communication: jitter(),
          problemSolving: jitter(),
          cultureFit: jitter(),
          strengths: pick(STRENGTH_TEMPLATES),
          concerns: lean && chance(0.4) ? "" : pick(CONCERN_TEMPLATES),
          notes: `Round ${roundNumber} (${spec.title}). ${
            lean
              ? "Would work with this person and would advocate for moving forward."
              : "Not a fit for this role at this level; encouraged to reconnect later."
          }`,
          submittedAt: new Date(submittedMs),
          createdAt: new Date(submittedMs),
        });

        activity(
          "submission",
          submissionId,
          "feedback_submitted",
          p.id!,
          `${p.name} submitted feedback for ${who}`,
          submittedMs,
          { requisitionId: req.id, candidateId: candidate.id, interviewId },
        );
      }
    }

    return { positive, completed: ivStatus === "completed" };
  }

  if (furthest >= 3) {
    const roundsRun = hired || furthest >= 4 ? int(3, loop.length) : int(1, 3);
    let ivCursor = enteredAt[3]!;
    let lastRound = 0;

    for (let r = 1; r <= roundsRun; r += 1) {
      ivCursor += int(2, 7) * DAY;
      const scheduledAt = businessMoment(ivCursor, 9, 16);
      if (scheduledAt > NOW) break; // the rest of the loop has not happened yet

      lastRound = r;
      // Anyone who got to offer or hire must have cleared every round.
      const result = pushInterview(r, scheduledAt, furthest >= 4 ? true : undefined);
      if (result.completed && !result.positive) break; // the loop ends on a no
    }

    // Live candidates mid-loop usually have their next round already booked.
    // The budget is only drawn down here, where an upcoming interview is
    // actually created, so it maps one-to-one onto the schedule view.
    if (kind === "live" && furthest === 3 && budget.upcomingInterviews > 0 && chance(0.78)) {
      budget.upcomingInterviews -= 1;
      pushInterview(lastRound + 1, businessMoment(daysAgo(-int(1, 16)), 9, 16));
    }
  }

  /* --- Offer ----------------------------------------------------- */

  if (furthest >= 4) {
    const offerStart = enteredAt[4]!;
    const lo = req.minSalary ?? 120000;
    const hi = req.maxSalary ?? 180000;
    const base = Math.round(clampNum(lo + rand() * (hi - lo), lo, hi) / 500) * 500;

    let offerStatus: string;
    let respondedAt: number | null = null;
    let declineReason: string | null = null;

    if (hired) {
      offerStatus = "accepted";
      respondedAt = Math.min(NOW - DAY, offerStart + int(2, 9) * DAY);
    } else if (kind === "live") {
      offerStatus = weighted([
        ["extended", 44],
        ["pending_approval", 22],
        ["approved", 18],
        ["draft", 16],
      ] as [string, number][]);
    } else {
      offerStatus = weighted([
        ["declined", 60],
        ["expired", 20],
        ["rescinded", 20],
      ] as [string, number][]);
      respondedAt = closedAt;
      declineReason =
        offerStatus === "declined"
          ? pick([
              "Accepted a competing offer",
              "Compensation below expectation",
              "Counter-offer from current employer",
              "Relocation / commute",
              "Role scope not a fit",
            ])
          : null;
    }

    const extended = ["extended", "accepted", "declined", "expired", "rescinded"].includes(offerStatus);
    const offerId = id("ofr");

    offers.push({
      id: offerId,
      submissionId,
      status: offerStatus,
      baseSalary: base,
      bonusPercent: pick([0, 0, 5, 10, 10, 12, 15, 20]),
      signingBonus: chance(0.42) ? int(5, 30) * 1000 : 0,
      equityUnits: chance(0.55) ? int(200, 4000) : 0,
      currency: "USD",
      startDate: isoDay((respondedAt ?? offerStart) + int(14, 60) * DAY),
      expiresAt: isoDay(offerStart + int(5, 12) * DAY),
      extendedAt: extended ? new Date(Math.min(NOW, businessMoment(offerStart + int(1, 4) * DAY))) : null,
      respondedAt: respondedAt ? new Date(respondedAt) : null,
      approvedById: ["approved", "extended", "accepted", "declined", "expired"].includes(offerStatus)
        ? pick(leadership).id!
        : null,
      createdById: owner,
      declineReason,
      version: chance(0.22) ? 2 : 1,
      notes: chance(0.3)
        ? "Compensation committee approved a 4% exception above band to stay competitive with a known counter-offer."
        : "",
      createdAt: new Date(offerStart),
      updatedAt: new Date(respondedAt ?? Math.min(NOW, offerStart + 3 * DAY)),
    });

    activity("submission", submissionId, "offer_created", owner, `Offer drafted for ${who} — ${req.title}`, offerStart, {
      requisitionId: req.id,
      candidateId: candidate.id,
      offerId,
    });
    if (respondedAt) {
      activity("submission", submissionId, "offer_status", owner, `Offer ${offerStatus} by ${who}`, respondedAt, {
        requisitionId: req.id,
        candidateId: candidate.id,
        offerId,
      });
    }
  }

  /* --- Notes ----------------------------------------------------- */

  if (chance(kind === "live" ? 0.62 : 0.28)) {
    const author = pick([...recruiters, ...hiringManagers]);
    const when = Math.min(NOW, enteredAt[Math.min(furthest, 1)]! + int(0, 4) * DAY);
    notes.push({
      id: id("not"),
      entityType: "submission",
      entityId: submissionId,
      authorId: author.id!,
      body: pick(NOTE_TEMPLATES)
        .replace("{skill}", pick(candidate.skills as string[]))
        .replace("{notice}", String(candidate.noticePeriodDays)),
      pinned: chance(0.12),
      createdAt: new Date(when),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Run the simulation per requisition
 * ------------------------------------------------------------------ */

/** Only a limited number of genuinely upcoming interviews, so the week looks real. */
const budget = { upcomingInterviews: 46 };

for (const plan of reqPlans) {
  const { row: req, family, openedMs, ageDays, status } = plan;
  const ctx: SimContext = { req, family, loop: loopFor(req.department), openedMs };

  const historicalVolume = Math.round(
    clampNum(ageDays / 7.5, 3, 30) *
      (req.priority === "critical" ? 1.4 : req.priority === "high" ? 1.18 : req.priority === "low" ? 0.72 : 1) *
      (0.8 + rand() * 0.5),
  );

  const hiresTarget =
    status === "filled" ? req.openings! : req.openings! > 1 && chance(0.28) ? 1 : 0;

  const liveTarget =
    status === "cancelled"
      ? 0
      : status === "draft"
        ? int(0, 3)
        : status === "filled"
          ? int(0, 2)
          : status === "on_hold"
            ? int(2, 5)
            : int(5, 13);

  for (let h = 0; h < hiresTarget; h += 1) buildSubmission(ctx, "hired", budget);
  for (let l = 0; l < liveTarget; l += 1) buildSubmission(ctx, "live", budget);

  const closedCount = Math.max(0, historicalVolume - hiresTarget - liveTarget);
  for (let c = 0; c < closedCount; c += 1) buildSubmission(ctx, "closed", budget);

  /* --- Reconcile requisition state ---------------------------- */

  req.filled = hiresTarget;
  req.status = status;
  if (status === "filled" || status === "cancelled") {
    req.closedAt = isoDay(Math.min(NOW - DAY, openedMs + int(24, Math.max(30, ageDays)) * DAY));
    activity(
      "requisition",
      req.id,
      "requisition_status",
      req.leadRecruiterId!,
      `${req.code} marked ${status}`,
      new Date(req.closedAt).getTime(),
    );
  } else if (status === "on_hold") {
    activity(
      "requisition",
      req.id,
      "requisition_status",
      req.leadRecruiterId!,
      `${req.code} placed on hold`,
      NOW - int(2, 25) * DAY,
    );
  }

  if (chance(0.5)) {
    notes.push({
      id: id("not"),
      entityType: "requisition",
      entityId: req.id,
      authorId: req.leadRecruiterId!,
      body: pick([
        `Intake call complete. Must-haves narrowed to ${(req.skills as string[]).slice(0, 3).join(", ")}; everything else is coachable.`,
        "Hiring manager wants a slate of four before making any decisions. Holding submissions until we have breadth.",
        "Market feedback: our band is roughly 8% under comparable roles in this metro. Raised with compensation.",
        "Approved to engage an agency partner if we do not have three qualified candidates in the loop within two weeks.",
        "Scorecard finalised with the panel. Everyone has been briefed on the rubric and the bar for each competency.",
        "Two candidates dropped over the on-site expectation. Worth revisiting the work-mode requirement with the client.",
      ]),
      pinned: chance(0.28),
      createdAt: new Date(Math.min(NOW, openedMs + int(1, 6) * DAY)),
    });
  }
}

/* ------------------------------------------------------------------ *
 * 6. Write everything
 * ------------------------------------------------------------------ */

const CONNECTION =
  process.env.DATABASE_URL ?? "postgres://rcc:rcc_local_dev@localhost:5433/rcc";

const pool = new Pool({ connectionString: CONNECTION, max: 4 });
const db = drizzle(pool, { schema: s });

/**
 * Drop and recreate rather than deleting a file: the database now lives in
 * Postgres, and `drop schema public cascade` is the equivalent clean slate.
 * Safe because this script is only ever pointed at a development database.
 */
async function reset() {
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
  // Drizzle records applied migrations in its own schema. Dropping only
  // `public` would leave that ledger behind, the migrator would believe the
  // work was already done, and the tables would never be recreated.
  await pool.query("drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

async function insertAll(table: never, rows: unknown[], label: string) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(table)
      .values(rows.slice(i, i + CHUNK) as never);
  }
  console.log(`  ${label.padEnd(20)} ${String(rows.length).padStart(5)}`);
}

async function main() {
  console.log("");
  console.log("Seeding Recruitment Command Center");
  console.log(`  target ${CONNECTION.replace(/:[^:@]*@/, ":****@")}`);
  console.log("");

  await reset();

  const roleRows = ROLES.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    rank: r.rank,
    isSystem: true,
    createdAt: new Date(NOW),
  }));
  const permissionRows = PERMISSIONS.map((p) => ({
    key: p.key,
    label: p.label,
    category: p.category,
    description: p.description,
    sensitive: Boolean((p as { sensitive?: boolean }).sensitive),
  }));
  const rolePermissionRows = ROLES.flatMap((r) =>
    r.permissions.map((perm) => ({
      id: id("rpm"),
      roleKey: r.key,
      permissionKey: perm,
    })),
  );

  // Postgres enforces foreign keys immediately, so parents go in first.
  await insertAll(s.roles as never, roleRows, "roles");
  await insertAll(s.permissions as never, permissionRows, "permissions");
  await insertAll(s.rolePermissions as never, rolePermissionRows, "role permissions");
  await insertAll(s.users as never, users, "users");
  await insertAll(s.clients as never, clients, "clients");
  await insertAll(s.requisitions as never, requisitions, "requisitions");
  await insertAll(s.requisitionAssignees as never, reqAssignees, "req assignees");
  await insertAll(s.candidates as never, candidates, "candidates");
  await insertAll(s.submissions as never, submissions, "submissions");
  await insertAll(s.stageEvents as never, stageEvents, "stage events");
  await insertAll(s.interviews as never, interviews, "interviews");
  await insertAll(s.interviewPanel as never, panels, "panel members");
  await insertAll(s.feedback as never, feedbacks, "feedback");
  await insertAll(s.offers as never, offers, "offers");
  await insertAll(s.notes as never, notes, "notes");
  await insertAll(s.activities as never, activities, "activities");

  await pool.end();
  console.log("");
  console.log("Done.");
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
