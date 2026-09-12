import { z } from "zod";

import {
  AUTHORED_REQ_STATUSES,
  AVAILABILITIES,
  CHANNELS,
  CANDIDATE_STATUSES,
  DECLINE_REASONS,
  DIRECTIONS,
  EMPLOYMENT_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_TYPES,
  OFFER_STATUSES,
  PRIORITIES,
  RECOMMENDATIONS,
  REJECTION_REASONS,
  SENIORITIES,
  RATE_BASES,
  REQUISITION_SOURCES,
  SOURCES,
  WORK_AUTHORIZATIONS,
  WORK_MODES,
} from "./domain";

const values = <T extends { value: string }>(list: T[]) =>
  list.map((m) => m.value) as [string, ...string[]];

const nonEmpty = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const optionalText = (max = 4000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const money = z.coerce.number().int().min(0).max(10_000_000);

/** Comma or newline separated list -> trimmed, de-duplicated array. */
export const listField = z
  .string()
  .optional()
  .transform((v) =>
    Array.from(
      new Set(
        (v ?? "")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ),
  );

/* ------------------------------------------------------------------ *
 * Requisitions
 * ------------------------------------------------------------------ */

export const requisitionSchema = z
  .object({
    title: nonEmpty("Job title"),
    clientId: nonEmpty("Client"),
    hiringManagerId: nonEmpty("Hiring manager"),
    leadRecruiterId: nonEmpty("Lead recruiter"),
    backupRecruiterId: optionalText(60),
    source: z.enum(values(REQUISITION_SOURCES)).default("client_direct"),
    scorecardTemplateId: optionalText(60),
    department: nonEmpty("Department", 80),
    employmentType: z.enum(values(EMPLOYMENT_TYPES)),
    workMode: z.enum(values(WORK_MODES)),
    seniority: z.enum(values(SENIORITIES)),
    priority: z.enum(values(PRIORITIES)),
    // Only the six authored statuses are settable; the other four are read
    // off the pipeline and would be overwritten on the next card move.
    status: z.enum(values(AUTHORED_REQ_STATUSES)).default("open"),
    location: nonEmpty("Location", 120),
    openings: z.coerce.number().int().min(1).max(50),
    minSalary: money.optional(),
    maxSalary: money.optional(),
    experienceMin: z.coerce.number().int().min(0).max(40).default(0),
    experienceMax: z.coerce.number().int().min(0).max(40).default(10),
    requiredSkills: listField,
    preferredSkills: listField,
    visaRequirements: z.array(z.enum(values(WORK_AUTHORIZATIONS))).default([]),
    requirements: listField,
    description: optionalText(),
    targetFillDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine((d) => !d.backupRecruiterId || d.backupRecruiterId !== d.leadRecruiterId, {
    message: "Backup must be someone other than the lead",
    path: ["backupRecruiterId"],
  })
  .refine((d) => d.minSalary == null || d.maxSalary == null || d.maxSalary >= d.minSalary, {
    message: "Maximum salary must be at least the minimum",
    path: ["maxSalary"],
  })
  .refine((d) => d.experienceMax >= d.experienceMin, {
    message: "Maximum experience must be at least the minimum",
    path: ["experienceMax"],
  });

export const requisitionStatusSchema = z.object({
  requisitionId: nonEmpty("Requisition"),
  status: z.enum(values(AUTHORED_REQ_STATUSES)),
  reason: optionalText(500),
});

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

export const candidateSchema = z.object({
  firstName: nonEmpty("First name", 80),
  lastName: nonEmpty("Last name", 80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  phone: optionalText(40),
  location: nonEmpty("Location", 120),
  currentTitle: nonEmpty("Current title", 120),
  currentCompany: nonEmpty("Current company", 120),
  yearsExperience: z.coerce.number().min(0).max(60),
  seniority: z.enum(values(SENIORITIES)),
  source: z.enum(values(SOURCES)),
  sourceDetail: optionalText(160),
  ownerId: nonEmpty("Owner"),
  status: z.enum(values(CANDIDATE_STATUSES)).default("new"),
  expectedSalary: money.optional(),
  currentSalary: money.optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(180).default(14),
  primaryTechnology: optionalText(80),
  availability: z.enum(values(AVAILABILITIES)).default("one_month"),
  availableFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  expectedRate: z.coerce.number().int().min(0).max(10_000).optional(),
  rateBasis: z.enum(values(RATE_BASES)).default("hourly"),
  workAuthorization: z.enum(values(WORK_AUTHORIZATIONS)),
  willingToRelocate: z.coerce.boolean().default(false),
  linkedinUrl: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  rating: z.coerce.number().int().min(0).max(5).default(0),
  skills: listField,
  tags: listField,
  summary: optionalText(2000),
});

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

/**
 * A stage key.
 *
 * Not an enum: stages are configuration now, so the valid set is not known when
 * this module loads. Shape is checked here and membership in the action against
 * the pipeline that is actually configured — which is also the only place that
 * can give a useful message when a stage has been renamed out from under a
 * stale tab.
 */
const stageKey = z.string().trim().min(1, "Pick a stage").max(60);

export const addToPipelineSchema = z.object({
  candidateId: nonEmpty("Candidate"),
  requisitionId: nonEmpty("Requisition"),
  stage: stageKey.optional(),
  matchScore: z.coerce.number().int().min(0).max(100).default(70),
  note: optionalText(1000),
});

export const moveStageSchema = z.object({
  submissionId: nonEmpty("Submission"),
  stage: stageKey,
  note: optionalText(1000),
});

export const rejectSchema = z.object({
  submissionId: nonEmpty("Submission"),
  outcome: z.enum(["rejected", "withdrawn"]),
  reason: z.enum(REJECTION_REASONS as unknown as [string, ...string[]]),
  note: optionalText(1000),
});

/**
 * On Hold is a terminal *state* but not a closure: the candidate is parked and
 * expected back, so it is reversible through `reopenSubmission` and does not
 * ask for a rejection reason.
 */
export const holdSchema = z.object({
  submissionId: nonEmpty("Submission"),
  note: optionalText(1000),
});

export const reopenSchema = z.object({
  submissionId: nonEmpty("Submission"),
  stage: stageKey.optional(),
});

/* ------------------------------------------------------------------ *
 * Interviews and feedback
 * ------------------------------------------------------------------ */

export const interviewSchema = z.object({
  submissionId: nonEmpty("Submission"),
  title: nonEmpty("Interview title", 120),
  type: z.enum(values(INTERVIEW_TYPES)),
  mode: z.enum(values(INTERVIEW_MODES)),
  scheduledAt: z.string().min(1, "Pick a date and time"),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  /** IANA zone the time above was entered in. */
  timezone: nonEmpty("Timezone", 60).default("America/New_York"),
  locationOrLink: optionalText(300),
  agenda: optionalText(1000),
  panelIds: z.array(z.string()).min(1, "Add at least one interviewer"),
  organizerId: nonEmpty("Organiser"),
});

export const interviewOutcomeSchema = z.object({
  interviewId: nonEmpty("Interview"),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show", "rescheduled"]),
  outcome: z
    .enum(["strong_yes", "yes", "lean_yes", "lean_no", "no", "strong_no", "pending"])
    .default("pending"),
});

/**
 * A scorecard. The competencies are whatever the template says, so the scores
 * arrive as a keyed map rather than named columns — validated for shape here
 * and checked against the actual template in the action.
 */
export const feedbackSchema = z.object({
  interviewId: nonEmpty("Interview"),
  interviewerId: nonEmpty("Interviewer"),
  recommendation: z.enum(values(RECOMMENDATIONS)),
  overall: z.coerce.number().int().min(1).max(5),
  scores: z.record(z.string().max(60), z.coerce.number().int().min(1).max(5)).default({}),
  strengths: optionalText(2000),
  concerns: optionalText(2000),
  notes: optionalText(4000),
});

/** An interviewer standing down from a round they cannot score. */
export const declineFeedbackSchema = z.object({
  interviewId: nonEmpty("Interview"),
  interviewerId: nonEmpty("Interviewer"),
  reason: optionalText(500),
});

/* ------------------------------------------------------------------ *
 * Offers
 * ------------------------------------------------------------------ */

export const offerSchema = z.object({
  submissionId: nonEmpty("Submission"),
  baseSalary: money,
  bonusPercent: z.coerce.number().min(0).max(200).default(0),
  signingBonus: money.default(0),
  equityUnits: z.coerce.number().int().min(0).max(10_000_000).default(0),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: optionalText(2000),
});

export const offerTransitionSchema = z.object({
  offerId: nonEmpty("Offer"),
  status: z.enum(values(OFFER_STATUSES)),
  declineReason: z
    .enum(DECLINE_REASONS as unknown as [string, ...string[]])
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/* ------------------------------------------------------------------ *
 * Communication
 * ------------------------------------------------------------------ */

export const communicationSchema = z.object({
  candidateId: nonEmpty("Candidate"),
  submissionId: optionalText(60),
  channel: z.enum(values(CHANNELS)),
  direction: z.enum(values(DIRECTIONS)).default("outbound"),
  subject: optionalText(200),
  body: nonEmpty("What was said", 4000),
  /** Local datetime from the form; blank means it just happened. */
  occurredAt: optionalText(40),
  followUpAt: optionalText(40),
});

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * A pipeline stage an administrator is editing (§8).
 *
 * `kind` is the field that carries meaning, so it is the one field a built-in
 * stage cannot have changed: re-labelling "Client Review" is a cosmetic choice,
 * but declaring it a placement stage would silently rewrite what the funnel,
 * the interview sync and requirement statuses all mean.
 */
export const stageSchema = z.object({
  stageId: optionalText(60),
  key: z
    .string()
    .trim()
    .min(2, "Give the stage a key")
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "Lower case letters, digits and underscores only"),
  label: nonEmpty("Label", 60),
  kind: z.enum(["sourcing", "submitted", "interviewing", "offer", "placement"]),
  tone: nonEmpty("Colour", 20),
  description: optionalText(200),
  slaDays: z.coerce.number().int().min(0).max(120),
  position: z.coerce.number().int().min(0).max(99),
  active: z.coerce.boolean().default(true),
});

export const stageOrderSchema = z.object({
  order: z.array(z.string().max(60)).min(1),
});

/* ------------------------------------------------------------------ *
 * Scorecard templates
 * ------------------------------------------------------------------ */

/**
 * A scorecard template and its competencies, saved together.
 *
 * One schema rather than a template schema plus a criterion schema, because
 * a template with no competencies is a scorecard nobody can fill in, and a
 * criterion with no template is nothing at all. Saving them as one thing means
 * the invalid intermediate states cannot be reached.
 *
 * The criteria arrive as three parallel arrays because that is what a form of
 * repeated rows submits; they are zipped in the action, where a length
 * mismatch can be reported rather than silently misaligning a label with
 * somebody else's key.
 */
export const scorecardTemplateSchema = z.object({
  templateId: optionalText(60),
  name: nonEmpty("Name", 80),
  description: optionalText(300),
  isDefault: z.coerce.boolean().default(false),
  active: z.coerce.boolean().default(true),
  criterionKey: z
    .array(
      z
        .string()
        .trim()
        .min(2, "Give each competency a key")
        .max(40)
        .regex(/^[a-z][a-z0-9_]*$/, "Lower case letters, digits and underscores only"),
    )
    .min(1, "A scorecard needs at least one competency")
    .max(12, "Twelve competencies is already more than a panel will fill in honestly"),
  criterionLabel: z.array(z.string().trim().min(1, "Label").max(60)).min(1),
  criterionDescription: z.array(z.string().trim().max(200)).default([]),
  rowVersion: z.coerce.number().int().optional(),
});

export const scorecardDeleteSchema = z.object({
  templateId: nonEmpty("Template"),
});

/* ------------------------------------------------------------------ *
 * Role permissions
 * ------------------------------------------------------------------ */

/**
 * One cell of the permission matrix.
 *
 * Deliberately one cell at a time rather than the whole grid. A form that
 * posts every checkbox would let two administrators editing at once silently
 * undo each other's changes, and it would make the audit entry read "changed
 * permissions" rather than naming what changed.
 */
export const rolePermissionSchema = z.object({
  roleKey: nonEmpty("Role"),
  permissionKey: nonEmpty("Permission"),
  granted: z.coerce.boolean(),
});

/* ------------------------------------------------------------------ *
 * Notes
 * ------------------------------------------------------------------ */

export const noteSchema = z.object({
  entityType: z.enum(["candidate", "requisition", "submission"]),
  entityId: nonEmpty("Entity"),
  body: nonEmpty("Note", 4000),
  pinned: z.coerce.boolean().default(false),
});

export type RequisitionInput = z.infer<typeof requisitionSchema>;
export type CandidateInput = z.infer<typeof candidateSchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
export type OfferInput = z.infer<typeof offerSchema>;
