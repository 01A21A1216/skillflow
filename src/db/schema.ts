import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Shared column helpers
 *
 * Four concerns appear on nearly every business table and are declared
 * once here so they cannot drift:
 *
 *   createdAt / updatedAt   when the row changed
 *   createdBy / updatedBy   who changed it            (§20)
 *   deletedAt / deletedBy   soft delete + recovery    (§20)
 *   rowVersion              optimistic concurrency    (§20)
 *
 * `rowVersion` starts at 1 and every update must supply the version it
 * read. The action layer compares and swaps, so two recruiters editing the
 * same record cannot silently overwrite each other.
 * ------------------------------------------------------------------ */

const pk = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Audit + soft delete + concurrency, for tables that users edit directly. */
const stewardship = () => ({
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  rowVersion: integer("row_version").notNull().default(1),
});

/* ------------------------------------------------------------------ *
 * People: recruiters, hiring managers, coordinators, interviewers
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull(),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("America/New_York"),
    accent: text("accent").notNull().default("indigo"),
    capacity: integer("capacity").notNull().default(12),
    active: boolean("active").notNull().default(true),
    joinedAt: text("joined_at").notNull(),
    /** scrypt digest, stored as `scrypt$N$r$p$salt$hash`. Null = cannot sign in. */
    passwordHash: text("password_hash"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    ...stewardship(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), index("users_deleted_idx").on(t.deletedAt)],
);

/* ------------------------------------------------------------------ *
 * Identity and access control
 * ------------------------------------------------------------------ */

export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  rank: integer("rank").notNull().default(100),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: createdAt(),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  sensitive: boolean("sensitive").notNull().default(false),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: pk(),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("role_permission_idx").on(t.roleKey, t.permissionKey),
    index("role_permission_role_idx").on(t.roleKey),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("session_token_idx").on(t.tokenHash),
    index("session_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Client accounts / business units that raise requirements
 * ------------------------------------------------------------------ */

export const clients = pgTable(
  "clients",
  {
    id: pk(),
    name: text("name").notNull(),
    industry: text("industry").notNull(),
    location: text("location").notNull(),
    tier: text("tier").notNull().default("standard"),
    accountOwnerId: text("account_owner_id").references(() => users.id),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    status: text("status").notNull().default("active"),
    slaDays: integer("sla_days").notNull().default(21),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [index("client_deleted_idx").on(t.deletedAt)],
);

/* ------------------------------------------------------------------ *
 * Requisitions (open job requirements)
 * ------------------------------------------------------------------ */

/**
 * Pipeline stages (§8).
 *
 * Rows, not a constant, so an administrator can rename, reorder, retune the SLA
 * of, disable, or add a stage. `kind` is what makes that safe: the application's
 * rules are written against the kind, so a new stage declared as `interviewing`
 * behaves like one everywhere — the interview sync owns it, the funnel counts
 * it, a requirement reads "Interviewing" from it — without a code change.
 *
 * Terminal states (rejected, withdrawn, on hold) are deliberately not here.
 * Each means something the application itself acts on, so adding a fourth would
 * be adding a rule rather than a column on a board.
 */
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: pk(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    tone: text("tone").notNull().default("slate"),
    description: text("description").notNull().default(""),
    slaDays: integer("sla_days").notNull().default(5),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Built-in stages cannot be deleted; the spec's eleven are the baseline. */
    builtIn: boolean("built_in").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    uniqueIndex("stage_key_idx").on(t.key),
    index("stage_position_idx").on(t.position),
  ],
);

export const requisitions = pgTable(
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
    /** Scorecard this requirement's panels fill in. Null falls back to the default. */
    scorecardTemplateId: text("scorecard_template_id"),
    /** Cover for the lead. Named on the requirement so escalation has an owner. */
    backupRecruiterId: text("backup_recruiter_id").references(() => users.id),
    /** How the requirement reached us — client direct, RFP, repeat business (§5). */
    source: text("source").notNull().default("client_direct"),
    department: text("department").notNull(),
    employmentType: text("employment_type").notNull(),
    workMode: text("work_mode").notNull(),
    location: text("location").notNull(),
    openings: integer("openings").notNull().default(1),
    filled: integer("filled").notNull().default(0),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    seniority: text("seniority").notNull().default("mid"),
    minSalary: integer("min_salary"),
    maxSalary: integer("max_salary"),
    billRateMin: integer("bill_rate_min"),
    billRateMax: integer("bill_rate_max"),
    currency: text("currency").notNull().default("USD"),
    experienceMin: integer("experience_min").notNull().default(0),
    experienceMax: integer("experience_max").notNull().default(10),
    /** Must-haves. A candidate without these is not submittable. */
    requiredSkills: jsonb("required_skills").$type<string[]>().notNull().default([]),
    /** Nice-to-haves. They raise a match score but never gate a submission. */
    preferredSkills: jsonb("preferred_skills").$type<string[]>().notNull().default([]),
    /**
     * Work authorizations this client will accept, from `WORK_AUTHORIZATIONS`.
     * Empty means no constraint — not "none accepted".
     */
    visaRequirements: jsonb("visa_requirements").$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    openedAt: text("opened_at").notNull(),
    targetFillDate: text("target_fill_date"),
    closedAt: text("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    uniqueIndex("req_code_idx").on(t.code),
    index("req_status_idx").on(t.status),
    index("req_client_idx").on(t.clientId),
    index("req_recruiter_idx").on(t.leadRecruiterId),
    index("req_deleted_idx").on(t.deletedAt),
  ],
);

export const requisitionAssignees = pgTable(
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

export const candidates = pgTable(
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
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    /** The one technology they lead with — what a recruiter searches on first. */
    primaryTechnology: text("primary_technology").notNull().default(""),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    referredById: text("referred_by_id").references(() => users.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("active"),
    expectedSalary: integer("expected_salary"),
    currentSalary: integer("current_salary"),
    currency: text("currency").notNull().default("USD"),
    noticePeriodDays: integer("notice_period_days").notNull().default(14),
    /** What they will commit to, as opposed to what their contract says. */
    availability: text("availability").notNull().default("one_month"),
    availableFrom: text("available_from"),
    /** Contract rate. `expectedSalary` stays the permanent-role number. */
    expectedRate: integer("expected_rate"),
    rateBasis: text("rate_basis").notNull().default("hourly"),
    workAuthorization: text("work_authorization").notNull().default("citizen"),
    willingToRelocate: boolean("willing_to_relocate").notNull().default(false),
    linkedinUrl: text("linkedin_url"),
    summary: text("summary").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    rating: integer("rating").notNull().default(0),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    /**
     * When this person's data was erased, and why (§23).
     *
     * Distinct from `deletedAt`, and the distinction is the whole point. A
     * soft delete hides a record and keeps every field, so it can be undone;
     * an erasure overwrites the personal data and cannot be. The row survives
     * because the submissions, interviews and offers attached to it are the
     * organisation's own records of its hiring process, which it is entitled
     * and often required to keep — but they are attached to a tombstone,
     * with nothing left that identifies a person.
     *
     * The date and the reason are kept deliberately: a data controller has to
     * be able to show that a request was honoured, and "this row is empty"
     * is not evidence of anything.
     */
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    erasedBy: text("erased_by"),
    /** "request" (the person asked) or "retention" (the policy expired). */
    erasureReason: text("erasure_reason"),
    /**
     * Consent to be kept on file past the retention period.
     *
     * Null means never asked, which the retention sweep treats as no — a
     * record nobody has touched in two years and who never agreed to be kept
     * is exactly what a retention policy exists to remove.
     */
    retentionConsentAt: timestamp("retention_consent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    uniqueIndex("cand_email_idx").on(t.email),
    index("cand_owner_idx").on(t.ownerId),
    index("cand_status_idx").on(t.status),
    index("cand_deleted_idx").on(t.deletedAt),
    index("cand_erased_idx").on(t.erasedAt),
  ],
);

/**
 * Education and work history.
 *
 * Separate tables rather than a jsonb blob on the candidate, because the
 * Candidate 360 renders them as ordered sections and a resume parser will
 * write rows here one at a time.
 */
export const candidateEducation = pgTable(
  "candidate_education",
  {
    id: pk(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    qualification: text("qualification").notNull(),
    field: text("field").notNull().default(""),
    startYear: integer("start_year"),
    endYear: integer("end_year"),
    grade: text("grade"),
    createdAt: createdAt(),
  },
  (t) => [index("edu_cand_idx").on(t.candidateId)],
);

export const candidateExperience = pgTable(
  "candidate_experience",
  {
    id: pk(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    /** ISO month, `YYYY-MM`. Null `endedOn` means this is the current role. */
    startedOn: text("started_on").notNull(),
    endedOn: text("ended_on"),
    summary: text("summary").notNull().default(""),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("exp_cand_idx").on(t.candidateId)],
);

/**
 * In-app notifications (§14).
 *
 * One row per person per event, which is deliberate: a notification is a
 * *delivery*, and read state belongs to the reader rather than to the event.
 * Fanning out at write time also means the inbox query is a single indexed
 * read rather than a re-evaluation of who should have been told.
 *
 * `dedupeKey` is what stops the same fact arriving five times — an SLA sweep
 * that runs hourly must not produce an hourly reminder.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    /** Who or what caused it. Null for a system sweep. */
    actorId: text("actor_id").references(() => users.id),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** Stable per (person, fact): a repeat delivery is refused, not duplicated. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notification_dedupe_idx").on(t.userId, t.dedupeKey),
    index("notification_inbox_idx").on(t.userId, t.readAt),
    index("notification_created_idx").on(t.createdAt),
  ],
);

/**
 * Contact history with a candidate (§7).
 *
 * Logged by hand rather than synced: this application does not own anyone's
 * mailbox, and pretending to a complete record it cannot have would be worse
 * than an honest partial one. The integration ports (§22, item 4.4) are where
 * a real mail or dialler feed would land, writing the same rows.
 */
export const communications = pgTable(
  "communications",
  {
    id: pk(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    /** Optional: the requirement this conversation was about. */
    submissionId: text("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    direction: text("direction").notNull().default("outbound"),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    /** What happens next, if anything. Drives the follow-up queue. */
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    loggedById: text("logged_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("comm_candidate_idx").on(t.candidateId),
    index("comm_followup_idx").on(t.followUpAt),
  ],
);

/**
 * Files attached to any record — resumes, job descriptions, client briefs.
 *
 * The bytes live behind a storage port (`src/server/storage.ts`), so this row
 * holds only the key to fetch them by. Nothing here assumes a local disk or a
 * particular cloud provider (§22), and nothing is served from a guessable path
 * (§23) — reads go through a permission-checked route.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: pk(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    kind: text("kind").notNull().default("document"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Content hash, so the same file uploaded twice is recognised. */
    digest: text("digest").notNull().default(""),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("att_entity_idx").on(t.entityType, t.entityId),
    index("att_deleted_idx").on(t.deletedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Submissions: a candidate moving through one requisition pipeline
 * ------------------------------------------------------------------ */

export const submissions = pgTable(
  "submissions",
  {
    id: pk(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    requisitionId: text("requisition_id")
      .notNull()
      .references(() => requisitions.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("new"),
    status: text("status").notNull().default("active"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    matchScore: integer("match_score").notNull().default(0),
    expectedRate: integer("expected_rate"),
    rejectionReason: text("rejection_reason"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    stageSince: timestamp("stage_since", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    uniqueIndex("sub_unique_idx").on(t.candidateId, t.requisitionId),
    index("sub_req_idx").on(t.requisitionId),
    index("sub_stage_idx").on(t.stage),
    index("sub_status_idx").on(t.status),
    index("sub_deleted_idx").on(t.deletedAt),
  ],
);

export const stageEvents = pgTable(
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

export const interviews = pgTable(
  "interviews",
  {
    id: pk(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    round: integer("round").notNull().default(1),
    title: text("title").notNull(),
    type: text("type").notNull(),
    mode: text("mode").notNull().default("video"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Stored, not derived, so a round that overran records what actually happened. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    /**
     * IANA zone the interview was *booked* in. Instants are absolute; this is
     * how to say "9am in the candidate's morning" to a panel spread over three
     * continents without everyone doing the arithmetic themselves (§10).
     */
    timezone: text("timezone").notNull().default("America/New_York"),
    locationOrLink: text("location_or_link"),
    status: text("status").notNull().default("scheduled"),
    outcome: text("outcome").notNull().default("pending"),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => users.id),
    /** When every scorecard was due. Set from the SLA when the round completes. */
    feedbackDueAt: timestamp("feedback_due_at", { withTimezone: true }),
    /**
     * The calendar provider's own id for this booking (§22).
     *
     * Null when no provider is configured, which is the default. It is stored
     * rather than derived because updating or cancelling an invite needs the
     * provider's handle, and reconstructing one from our id would assume a
     * particular provider's id scheme — exactly what the port exists to avoid.
     */
    calendarEventId: text("calendar_event_id"),
    agenda: text("agenda"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    index("iv_sub_idx").on(t.submissionId),
    index("iv_time_idx").on(t.scheduledAt),
    index("iv_status_idx").on(t.status),
    index("iv_deleted_idx").on(t.deletedAt),
  ],
);

export const interviewPanel = pgTable(
  "interview_panel",
  {
    id: pk(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("interviewer"),
    /**
     * Whether this panelist still owes a scorecard (§10).
     *
     * Held here rather than inferred from the absence of a `feedback` row,
     * because "declined" and "has not got to it yet" are different facts and
     * only one of them is chaseable.
     */
    feedbackStatus: text("feedback_status").notNull().default("pending"),
  },
  (t) => [
    uniqueIndex("panel_unique_idx").on(t.interviewId, t.userId),
    index("panel_feedback_idx").on(t.feedbackStatus),
  ],
);

/**
 * Scorecard templates (§11).
 *
 * A template is a named set of competencies. Requirements point at one; a
 * panel without one falls back to the default. Because the criteria are rows
 * and the scores are a keyed map, adding a competency is an admin edit rather
 * than a migration.
 */
export const scorecardTemplates = pgTable(
  "scorecard_templates",
  {
    id: pk(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Exactly one template is the fallback for requirements that name none. */
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [uniqueIndex("scorecard_name_idx").on(t.name)],
);

export const scorecardCriteria = pgTable(
  "scorecard_criteria",
  {
    id: pk(),
    templateId: text("template_id")
      .notNull()
      .references(() => scorecardTemplates.id, { onDelete: "cascade" }),
    /** Stable key the scores map is written against. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("criteria_unique_idx").on(t.templateId, t.key)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: pk(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => users.id),
    recommendation: text("recommendation").notNull(),
    overall: integer("overall").notNull(),
    /** Template this scorecard was filled against, so old ones stay readable. */
    templateId: text("template_id").references(() => scorecardTemplates.id),
    /** `{ criterionKey: 1..5 }` — the shape follows the template, not the schema. */
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    strengths: text("strengths").notNull().default(""),
    concerns: text("concerns").notNull().default(""),
    notes: text("notes").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_unique_idx").on(t.interviewId, t.interviewerId)],
);

/* ------------------------------------------------------------------ *
 * Offers
 * ------------------------------------------------------------------ */

export const offers = pgTable(
  "offers",
  {
    id: pk(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    baseSalary: integer("base_salary").notNull(),
    bonusPercent: real("bonus_percent").notNull().default(0),
    signingBonus: integer("signing_bonus").notNull().default(0),
    equityUnits: integer("equity_units").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    startDate: text("start_date"),
    expiresAt: text("expires_at"),
    extendedAt: timestamp("extended_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    approvedById: text("approved_by_id").references(() => users.id),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    declineReason: text("decline_reason"),
    /** Offer revision number, distinct from `rowVersion` (concurrency). */
    version: integer("version").notNull().default(1),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...stewardship(),
  },
  (t) => [
    index("offer_sub_idx").on(t.submissionId),
    index("offer_status_idx").on(t.status),
    index("offer_deleted_idx").on(t.deletedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Notes + activity timeline
 * ------------------------------------------------------------------ */

export const notes = pgTable(
  "notes",
  {
    id: pk(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    ...stewardship(),
  },
  (t) => [
    index("note_entity_idx").on(t.entityType, t.entityId),
    index("note_deleted_idx").on(t.deletedAt),
  ],
);

/**
 * The audit trail.
 *
 * `summary` is the human sentence for the activity feed. `changes` is the
 * structured diff the specification asks for (§13): one entry per field, with
 * the value before and after, so the record can answer "who changed the
 * priority, from what, to what, and when" without parsing prose.
 */
export const activities = pgTable(
  "activities",
  {
    id: pk(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => users.id),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<FieldChange[]>(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_entity_idx").on(t.entityType, t.entityId),
    index("activity_time_idx").on(t.createdAt),
    index("activity_actor_idx").on(t.actorId),
    index("activity_type_idx").on(t.type),
  ],
);

/**
 * The work queue (§22).
 *
 * A table rather than Redis or SQS, because this deployment already has a
 * Postgres and `select … for update skip locked` is precisely the primitive a
 * queue needs: several workers can claim disjoint rows without blocking each
 * other or each other's readers. Adding a second piece of infrastructure to
 * run three sweeps and retry an HTTP call would be a cost with no matching
 * benefit.
 *
 * Everything about a job is visible: what it is, when it should run, how many
 * times it has been tried, what went wrong last time. That is the point. A
 * background job people cannot see is a background job nobody debugs — it just
 * quietly stops working and the first symptom is a notification that never
 * arrived.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    /** Which handler runs this. Unknown kinds fail loudly rather than vanish. */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** pending | running | done | failed */
    status: text("status").notNull().default("pending"),
    /** Not before this instant. Retries move it forward; nothing else does. */
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /**
     * Stable for the work, not the attempt.
     *
     * Recurring jobs use the occurrence they represent ("sweeps:2026-09-11T14"),
     * so several server instances racing to schedule the same tick produce one
     * row. Unique, which is what makes that a database guarantee rather than a
     * hope about timing.
     */
    dedupeKey: text("dedupe_key"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** Which worker holds it, so a crashed instance's rows can be identified. */
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /** Wall-clock cost of the last attempt, for seeing a handler slow down. */
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_idx").on(t.dedupeKey),
    // The claim query's index: pending rows, soonest first.
    index("jobs_claim_idx").on(t.status, t.runAt),
    index("jobs_kind_idx").on(t.kind),
  ],
);

export type Job = typeof jobs.$inferSelect;

/** One field-level before/after pair on an audit entry. */
export interface FieldChange {
  field: string;
  label: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

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
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Session = typeof sessions.$inferSelect;

/** Tables that carry the stewardship columns, for generic helpers. */
export const SOFT_DELETE_TABLES = [
  "users",
  "clients",
  "requisitions",
  "candidates",
  "submissions",
  "interviews",
  "offers",
  "notes",
] as const;

export { sql };
