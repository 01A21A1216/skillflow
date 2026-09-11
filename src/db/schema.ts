import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ------------------------------------------------------------------ *
 * Shared column helpers
 * ------------------------------------------------------------------ */

const pk = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/* ------------------------------------------------------------------ *
 * People: recruiters, hiring managers, coordinators, interviewers
 * ------------------------------------------------------------------ */

export const users = sqliteTable(
  "users",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(), // admin | recruiter | hiring_manager | coordinator | interviewer
    title: text("title").notNull(),
    department: text("department").notNull(),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("America/New_York"),
    accent: text("accent").notNull().default("indigo"),
    capacity: integer("capacity").notNull().default(12), // target concurrent reqs
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    joinedAt: text("joined_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/* ------------------------------------------------------------------ *
 * Client accounts / business units that raise requirements
 * ------------------------------------------------------------------ */

export const clients = sqliteTable("clients", {
  id: pk(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  location: text("location").notNull(),
  tier: text("tier").notNull().default("standard"), // strategic | key | standard
  accountOwnerId: text("account_owner_id").references(() => users.id),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  status: text("status").notNull().default("active"), // active | prospect | dormant
  slaDays: integer("sla_days").notNull().default(21),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ *
 * Requisitions (open job requirements)
 * ------------------------------------------------------------------ */

export const requisitions = sqliteTable(
  "requisitions",
  {
    id: pk(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    hiringManagerId: text("hiring_manager_id")
      .notNull()
      .references(() => users.id),
    leadRecruiterId: text("lead_recruiter_id")
      .notNull()
      .references(() => users.id),
    department: text("department").notNull(),
    employmentType: text("employment_type").notNull(), // full_time | contract | contract_to_hire | part_time | intern
    workMode: text("work_mode").notNull(), // onsite | hybrid | remote
    location: text("location").notNull(),
    openings: integer("openings").notNull().default(1),
    filled: integer("filled").notNull().default(0),
    priority: text("priority").notNull().default("medium"), // critical | high | medium | low
    status: text("status").notNull().default("open"), // draft | open | on_hold | filled | cancelled | closed
    seniority: text("seniority").notNull().default("mid"),
    minSalary: integer("min_salary"),
    maxSalary: integer("max_salary"),
    billRateMin: integer("bill_rate_min"),
    billRateMax: integer("bill_rate_max"),
    currency: text("currency").notNull().default("USD"),
    experienceMin: integer("experience_min").notNull().default(0),
    experienceMax: integer("experience_max").notNull().default(10),
    skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    requirements: text("requirements", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    openedAt: text("opened_at").notNull(),
    targetFillDate: text("target_fill_date"),
    closedAt: text("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("req_code_idx").on(t.code),
    index("req_status_idx").on(t.status),
    index("req_client_idx").on(t.clientId),
    index("req_recruiter_idx").on(t.leadRecruiterId),
  ],
);

export const requisitionAssignees = sqliteTable(
  "requisition_assignees",
  {
    id: pk(),
    requisitionId: text("requisition_id")
      .notNull()
      .references(() => requisitions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("recruiter"),
  },
  (t) => [uniqueIndex("req_assignee_idx").on(t.requisitionId, t.userId)],
);

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

export const candidates = sqliteTable(
  "candidates",
  {
    id: pk(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    location: text("location").notNull(),
    currentTitle: text("current_title").notNull(),
    currentCompany: text("current_company").notNull(),
    yearsExperience: real("years_experience").notNull().default(0),
    seniority: text("seniority").notNull().default("mid"),
    skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default([]),
    source: text("source").notNull(), // referral | job_board | linkedin | career_site | agency | event | inbound | sourced | rehire
    sourceDetail: text("source_detail"),
    referredById: text("referred_by_id").references(() => users.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("active"), // new | active | passive | placed | do_not_contact | archived
    expectedSalary: integer("expected_salary"),
    currentSalary: integer("current_salary"),
    currency: text("currency").notNull().default("USD"),
    noticePeriodDays: integer("notice_period_days").notNull().default(14),
    workAuthorization: text("work_authorization").notNull().default("citizen"),
    willingToRelocate: integer("willing_to_relocate", { mode: "boolean" })
      .notNull()
      .default(false),
    linkedinUrl: text("linkedin_url"),
    summary: text("summary").notNull().default(""),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    rating: integer("rating").notNull().default(0),
    lastContactedAt: integer("last_contacted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cand_email_idx").on(t.email),
    index("cand_owner_idx").on(t.ownerId),
    index("cand_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Submissions: a candidate moving through one requisition pipeline
 * ------------------------------------------------------------------ */

export const submissions = sqliteTable(
  "submissions",
  {
    id: pk(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    requisitionId: text("requisition_id")
      .notNull()
      .references(() => requisitions.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("sourced"),
    // sourced | screening | submitted | interview | offer | hired | rejected | withdrawn
    status: text("status").notNull().default("active"), // active | hired | rejected | withdrawn | on_hold
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    matchScore: integer("match_score").notNull().default(0),
    expectedRate: integer("expected_rate"),
    rejectionReason: text("rejection_reason"),
    rejectedAt: integer("rejected_at", { mode: "timestamp_ms" }),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    stageSince: integer("stage_since", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sub_unique_idx").on(t.candidateId, t.requisitionId),
    index("sub_req_idx").on(t.requisitionId),
    index("sub_stage_idx").on(t.stage),
    index("sub_status_idx").on(t.status),
  ],
);

export const stageEvents = sqliteTable(
  "stage_events",
  {
    id: pk(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    actorId: text("actor_id").references(() => users.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("stage_event_sub_idx").on(t.submissionId)],
);

/* ------------------------------------------------------------------ *
 * Interviews, panel, feedback
 * ------------------------------------------------------------------ */

export const interviews = sqliteTable(
  "interviews",
  {
    id: pk(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    round: integer("round").notNull().default(1),
    title: text("title").notNull(),
    type: text("type").notNull(), // phone_screen | technical | system_design | behavioral | panel | hiring_manager | client | final
    mode: text("mode").notNull().default("video"), // video | phone | onsite
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    locationOrLink: text("location_or_link"),
    status: text("status").notNull().default("scheduled"), // scheduled | completed | cancelled | no_show | rescheduled
    outcome: text("outcome").notNull().default("pending"), // strong_yes | yes | lean_yes | lean_no | no | strong_no | pending
    organizerId: text("organizer_id")
      .notNull()
      .references(() => users.id),
    agenda: text("agenda"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("iv_sub_idx").on(t.submissionId),
    index("iv_time_idx").on(t.scheduledAt),
    index("iv_status_idx").on(t.status),
  ],
);

export const interviewPanel = sqliteTable(
  "interview_panel",
  {
    id: pk(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("interviewer"), // interviewer | shadow | observer
  },
  (t) => [uniqueIndex("panel_unique_idx").on(t.interviewId, t.userId)],
);

export const feedback = sqliteTable(
  "feedback",
  {
    id: pk(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => users.id),
    recommendation: text("recommendation").notNull(), // strong_hire | hire | lean_hire | lean_no_hire | no_hire
    overall: integer("overall").notNull(),
    technical: integer("technical").notNull(),
    communication: integer("communication").notNull(),
    problemSolving: integer("problem_solving").notNull(),
    cultureFit: integer("culture_fit").notNull(),
    strengths: text("strengths").notNull().default(""),
    concerns: text("concerns").notNull().default(""),
    notes: text("notes").notNull().default(""),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_unique_idx").on(t.interviewId, t.interviewerId)],
);

/* ------------------------------------------------------------------ *
 * Offers
 * ------------------------------------------------------------------ */

export const offers = sqliteTable(
  "offers",
  {
    id: pk(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    // draft | pending_approval | approved | extended | accepted | declined | rescinded | expired
    baseSalary: integer("base_salary").notNull(),
    bonusPercent: real("bonus_percent").notNull().default(0),
    signingBonus: integer("signing_bonus").notNull().default(0),
    equityUnits: integer("equity_units").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    startDate: text("start_date"),
    expiresAt: text("expires_at"),
    extendedAt: integer("extended_at", { mode: "timestamp_ms" }),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
    approvedById: text("approved_by_id").references(() => users.id),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    declineReason: text("decline_reason"),
    version: integer("version").notNull().default(1),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("offer_sub_idx").on(t.submissionId),
    index("offer_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Notes + activity timeline
 * ------------------------------------------------------------------ */

export const notes = sqliteTable(
  "notes",
  {
    id: pk(),
    entityType: text("entity_type").notNull(), // candidate | requisition | submission
    entityId: text("entity_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("note_entity_idx").on(t.entityType, t.entityId)],
);

export const activities = sqliteTable(
  "activities",
  {
    id: pk(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => users.id),
    summary: text("summary").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_entity_idx").on(t.entityType, t.entityId),
    index("activity_time_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Requisition = typeof requisitions.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type StageEvent = typeof stageEvents.$inferSelect;
