/**
 * Domain vocabulary for the Recruitment Command Center.
 *
 * Every stage / status / enum the product speaks is declared once here,
 * together with its label and visual treatment, so the database, the API
 * and the UI can never drift apart.
 */

export type Tone =
  | "neutral"
  | "slate"
  | "blue"
  | "indigo"
  | "violet"
  | "amber"
  | "emerald"
  | "rose"
  | "cyan"
  | "orange";

export interface Meta<T extends string> {
  value: T;
  label: string;
  tone: Tone;
  description?: string;
}

function index<T extends string>(list: Meta<T>[]) {
  return Object.fromEntries(list.map((m) => [m.value, m])) as Record<T, Meta<T>>;
}

/* ------------------------------------------------------------------ *
 * Pipeline stages
 * ------------------------------------------------------------------ */

export type Stage =
  | "new"
  | "screening"
  | "qualified"
  | "submitted"
  | "client_review"
  | "interview_scheduled"
  | "interview_completed"
  | "feedback_pending"
  | "selected"
  | "offer"
  | "joined"
  | "rejected"
  | "withdrawn"
  | "on_hold";

/**
 * The stages a submission passes through, in order (§8).
 *
 * Tones repeat where two stages are phases of one activity (the two interview
 * stages, Selected before Offer) — every badge and column carries its label, so
 * colour reinforces the phase rather than carrying identity on its own.
 */
export const PIPELINE_STAGES: Meta<Stage>[] = [
  { value: "new", label: "New", tone: "slate", description: "In the pipeline, not yet worked" },
  { value: "screening", label: "Screening", tone: "cyan", description: "Recruiter screen in progress" },
  { value: "qualified", label: "Qualified", tone: "cyan", description: "Screened and fit for the requirement" },
  { value: "submitted", label: "Submitted", tone: "blue", description: "Profile sent to the client" },
  { value: "client_review", label: "Client Review", tone: "indigo", description: "With the client for a decision" },
  { value: "interview_scheduled", label: "Interview Scheduled", tone: "violet", description: "Interview booked and confirmed" },
  { value: "interview_completed", label: "Interview Completed", tone: "violet", description: "Interview done, decision pending" },
  { value: "feedback_pending", label: "Feedback Pending", tone: "orange", description: "Waiting on interviewer feedback" },
  { value: "selected", label: "Selected", tone: "amber", description: "Chosen by the client, pre-offer" },
  { value: "offer", label: "Offer", tone: "amber", description: "Offer drafted, approved or extended" },
  { value: "joined", label: "Joined", tone: "emerald", description: "Started in the role" },
];

/**
 * Where a submission stopped. A closed-out submission keeps the terminal value
 * as its stage; `stage_events` still records the stage it left, so funnel
 * analytics can say where candidates are lost.
 */
export const TERMINAL_STAGES: Meta<Stage>[] = [
  { value: "rejected", label: "Rejected", tone: "rose" },
  { value: "withdrawn", label: "Withdrawn", tone: "neutral" },
  { value: "on_hold", label: "On hold", tone: "amber" },
];

export const ALL_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES];
export const STAGE = index(ALL_STAGES);
export const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.value);

/** Stages that still count as live pipeline — everything before Joined. */
export const ACTIVE_STAGES: Stage[] = PIPELINE_STAGES.filter((s) => s.value !== "joined").map(
  (s) => s.value,
);

/**
 * Target days a submission should spend in a stage before it is "aging".
 * Stages that are a handover to someone else (Client Review, Feedback Pending)
 * get tight SLAs because they are where pipelines silently stall.
 */
export const STAGE_SLA_DAYS: Record<Stage, number> = {
  new: 3,
  screening: 4,
  qualified: 3,
  submitted: 4,
  client_review: 5,
  interview_scheduled: 7,
  interview_completed: 3,
  feedback_pending: 2,
  selected: 4,
  offer: 7,
  joined: 0,
  rejected: 0,
  withdrawn: 0,
  on_hold: 0,
};

export function stageIndex(stage: Stage) {
  return STAGE_ORDER.indexOf(stage);
}

/** True once a submission has reached `mark`. Terminal stages are never "at" a live stage. */
export function atOrPast(stage: Stage, mark: Stage) {
  const i = stageIndex(stage);
  return i >= 0 && i >= stageIndex(mark);
}

/** The stages that mean an interview exists — used to keep interview state and stage in step. */
export const INTERVIEW_STAGES: Stage[] = [
  "interview_scheduled",
  "interview_completed",
  "feedback_pending",
];

/* ------------------------------------------------------------------ *
 * Submission status
 * ------------------------------------------------------------------ */

/**
 * Whether a submission is still live, and if not, why it stopped.
 *
 * `stage` says *where* a candidate is; `status` says whether they are still
 * moving. The two agree at the ends — a submission whose stage is `joined`
 * has status `hired` — and the word differs only because the pipeline's last
 * column is the candidate's event (they joined) while the status is the
 * outcome the business counts (a hire).
 */
export type SubmissionStatus = "active" | "hired" | "rejected" | "withdrawn" | "on_hold";

export const SUBMISSION_STATUSES: Meta<SubmissionStatus>[] = [
  { value: "active", label: "Active", tone: "blue" },
  { value: "on_hold", label: "On hold", tone: "amber" },
  { value: "hired", label: "Joined", tone: "emerald" },
  { value: "rejected", label: "Rejected", tone: "rose" },
  { value: "withdrawn", label: "Withdrawn", tone: "neutral" },
];
export const SUBMISSION_STATUS = index(SUBMISSION_STATUSES);

export const REJECTION_REASONS = [
  "Skills mismatch",
  "Insufficient experience",
  "Compensation misaligned",
  "Failed technical interview",
  "Culture / values fit",
  "Location or work-mode conflict",
  "Work authorization",
  "Position filled by another candidate",
  "Unresponsive",
  "Candidate withdrew",
] as const;

/* ------------------------------------------------------------------ *
 * Requisitions
 * ------------------------------------------------------------------ */

/**
 * Requirement statuses (§5).
 *
 * Ten statuses, but only six of them are *decisions*. Draft, Open, On hold,
 * Filled, Cancelled and Closed are set by a person and stored on the row. The
 * other four — Active Sourcing, Candidate Submitted, Interviewing, Offer —
 * describe how far the pipeline has got, and are derived from the submissions
 * on the requirement by `requisitionProgress()` below.
 *
 * Storing those four would create a second source of truth that drifts the
 * moment anyone moves a card, so they are computed on read and shown wherever a
 * status is shown. `requisitions.status` only ever holds an authored value.
 */
export type AuthoredReqStatus = "draft" | "open" | "on_hold" | "filled" | "cancelled" | "closed";
export type DerivedReqStatus =
  | "active_sourcing"
  | "candidate_submitted"
  | "interviewing"
  | "offer";
export type ReqStatus = AuthoredReqStatus | DerivedReqStatus;

export interface ReqStatusMeta extends Meta<ReqStatus> {
  /** True when a person sets this directly; false when it is read off the pipeline. */
  authored: boolean;
}

export const REQ_STATUSES: ReqStatusMeta[] = [
  { value: "draft", label: "Draft", tone: "neutral", authored: true },
  { value: "open", label: "Open", tone: "emerald", authored: true, description: "Approved, no candidates working yet" },
  { value: "active_sourcing", label: "Active Sourcing", tone: "cyan", authored: false, description: "Candidates in screening" },
  { value: "candidate_submitted", label: "Candidate Submitted", tone: "blue", authored: false, description: "Profiles with the client" },
  { value: "interviewing", label: "Interviewing", tone: "violet", authored: false, description: "Interviews under way" },
  { value: "offer", label: "Offer", tone: "amber", authored: false, description: "Someone is at offer stage" },
  { value: "filled", label: "Filled", tone: "indigo", authored: true },
  { value: "on_hold", label: "On hold", tone: "orange", authored: true },
  { value: "cancelled", label: "Cancelled", tone: "rose", authored: true },
  { value: "closed", label: "Closed", tone: "slate", authored: true },
];
export const REQ_STATUS = index(REQ_STATUSES as Meta<ReqStatus>[]);

/** The six a person can choose. The status menu and the form offer only these. */
export const AUTHORED_REQ_STATUSES = REQ_STATUSES.filter((s) => s.authored);

/** Counts of live submissions by stage on one requirement. */
export interface StageCounts {
  sourcing: number;
  submitted: number;
  interviewing: number;
  offer: number;
}

/**
 * Read the pipeline back as a status. Only meaningful for a requirement whose
 * authored status is `open` — a draft, on-hold, filled, cancelled or closed
 * requirement shows what the person decided, not what the pipeline is doing.
 */
export function requisitionProgress(stored: string, counts: StageCounts): ReqStatus {
  if (stored !== "open") return stored as ReqStatus;
  if (counts.offer > 0) return "offer";
  if (counts.interviewing > 0) return "interviewing";
  if (counts.submitted > 0) return "candidate_submitted";
  if (counts.sourcing > 0) return "active_sourcing";
  return "open";
}

/** Which `StageCounts` bucket a live stage falls into. */
export function progressBucket(stage: Stage): keyof StageCounts | null {
  switch (stage) {
    case "new":
    case "screening":
    case "qualified":
      return "sourcing";
    case "submitted":
    case "client_review":
      return "submitted";
    case "interview_scheduled":
    case "interview_completed":
    case "feedback_pending":
      return "interviewing";
    case "selected":
    case "offer":
      return "offer";
    default:
      return null;
  }
}

export const EMPTY_STAGE_COUNTS: StageCounts = {
  sourcing: 0,
  submitted: 0,
  interviewing: 0,
  offer: 0,
};

/**
 * The four buckets a requirement's live pipeline is summarised into.
 *
 * Eleven columns is the right resolution for a board someone is working in and
 * the wrong one for a bar in a table row, so every summary folds to these four
 * and the bar still totals the live pipeline rather than a subset of it.
 */
export const PROGRESS_BUCKETS: { key: keyof StageCounts; label: string; tone: Tone }[] = [
  { key: "sourcing", label: "Sourcing", tone: "cyan" },
  { key: "submitted", label: "Submitted", tone: "blue" },
  { key: "interviewing", label: "Interviewing", tone: "violet" },
  { key: "offer", label: "Offer", tone: "amber" },
];

/** Fold a per-stage count map into those four buckets. */
export function bucketStages(counts: Record<string, number> | undefined): StageCounts {
  const out = { ...EMPTY_STAGE_COUNTS };
  for (const [stage, n] of Object.entries(counts ?? {})) {
    const bucket = progressBucket(stage as Stage);
    if (bucket) out[bucket] += n;
  }
  return out;
}

export type Priority = "critical" | "high" | "medium" | "low";

export const PRIORITIES: Meta<Priority>[] = [
  { value: "critical", label: "Critical", tone: "rose" },
  { value: "high", label: "High", tone: "orange" },
  { value: "medium", label: "Medium", tone: "blue" },
  { value: "low", label: "Low", tone: "slate" },
];
export const PRIORITY = index(PRIORITIES);
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type EmploymentType =
  | "full_time"
  | "w2"
  | "c2c"
  | "contract"
  | "contract_to_hire"
  | "part_time"
  | "intern";

/**
 * Engagement types (§5). W-2 and corp-to-corp are the two that decide who
 * employs the person and therefore how the rate is quoted, so they are separate
 * values rather than a note on "contract".
 */
export const EMPLOYMENT_TYPES: Meta<EmploymentType>[] = [
  { value: "full_time", label: "Full-time", tone: "indigo", description: "Permanent, on our client's payroll" },
  { value: "w2", label: "W-2 contract", tone: "blue", description: "Contract, employed by us" },
  { value: "c2c", label: "Corp-to-corp", tone: "violet", description: "Contract through the candidate's own company" },
  { value: "contract", label: "Contract", tone: "cyan", description: "Contract, engagement model not yet fixed" },
  { value: "contract_to_hire", label: "Contract-to-hire", tone: "orange", description: "Contract with a conversion date" },
  { value: "part_time", label: "Part-time", tone: "slate" },
  { value: "intern", label: "Internship", tone: "neutral" },
];
export const EMPLOYMENT_TYPE = index(EMPLOYMENT_TYPES);

/** Engagements billed at an hourly rate rather than an annual salary. */
export const RATE_BASED_EMPLOYMENT: EmploymentType[] = ["w2", "c2c", "contract", "contract_to_hire"];

export function isRateBased(type: string) {
  return RATE_BASED_EMPLOYMENT.includes(type as EmploymentType);
}

/** How a requirement reached us (§5). Distinct from a *candidate's* source. */
export type RequisitionSource =
  | "client_direct"
  | "repeat_business"
  | "rfp"
  | "partner"
  | "referral"
  | "inbound";

export const REQUISITION_SOURCES: Meta<RequisitionSource>[] = [
  { value: "client_direct", label: "Client direct", tone: "indigo" },
  { value: "repeat_business", label: "Repeat business", tone: "emerald" },
  { value: "rfp", label: "RFP / tender", tone: "violet" },
  { value: "partner", label: "Partner / vendor", tone: "cyan" },
  { value: "referral", label: "Referral", tone: "blue" },
  { value: "inbound", label: "Inbound", tone: "slate" },
];
export const REQUISITION_SOURCE = index(REQUISITION_SOURCES);

export type WorkMode = "onsite" | "hybrid" | "remote";

export const WORK_MODES: Meta<WorkMode>[] = [
  { value: "remote", label: "Remote", tone: "emerald" },
  { value: "hybrid", label: "Hybrid", tone: "blue" },
  { value: "onsite", label: "Onsite", tone: "slate" },
];
export const WORK_MODE = index(WORK_MODES);

export type Seniority = "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "director";

export const SENIORITIES: Meta<Seniority>[] = [
  { value: "intern", label: "Intern", tone: "neutral" },
  { value: "junior", label: "Junior", tone: "slate" },
  { value: "mid", label: "Mid-level", tone: "blue" },
  { value: "senior", label: "Senior", tone: "indigo" },
  { value: "staff", label: "Staff", tone: "violet" },
  { value: "principal", label: "Principal", tone: "amber" },
  { value: "director", label: "Director", tone: "rose" },
];
export const SENIORITY = index(SENIORITIES);

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

export type CandidateStatus = "new" | "active" | "passive" | "placed" | "do_not_contact" | "archived";

export const CANDIDATE_STATUSES: Meta<CandidateStatus>[] = [
  { value: "new", label: "New", tone: "cyan" },
  { value: "active", label: "Active", tone: "blue" },
  { value: "passive", label: "Passive", tone: "slate" },
  { value: "placed", label: "Placed", tone: "emerald" },
  { value: "do_not_contact", label: "Do not contact", tone: "rose" },
  { value: "archived", label: "Archived", tone: "neutral" },
];
export const CANDIDATE_STATUS = index(CANDIDATE_STATUSES);

/**
 * How soon a candidate can start (§6).
 *
 * Kept separate from `noticePeriodDays`: the notice period is a fact about
 * their current job, availability is what they will commit to, and contractors
 * routinely have one without the other.
 */
export type Availability =
  | "immediate"
  | "two_weeks"
  | "one_month"
  | "two_months"
  | "not_looking";

export const AVAILABILITIES: Meta<Availability>[] = [
  { value: "immediate", label: "Immediately", tone: "emerald" },
  { value: "two_weeks", label: "2 weeks", tone: "cyan" },
  { value: "one_month", label: "1 month", tone: "blue" },
  { value: "two_months", label: "2 months +", tone: "amber" },
  { value: "not_looking", label: "Not looking", tone: "slate" },
];
export const AVAILABILITY = index(AVAILABILITIES);

/** What a rate is quoted against. Contract work is hourly; permanent is annual. */
export type RateBasis = "hourly" | "daily" | "annual";

export const RATE_BASES: Meta<RateBasis>[] = [
  { value: "hourly", label: "per hour", tone: "slate" },
  { value: "daily", label: "per day", tone: "slate" },
  { value: "annual", label: "per year", tone: "slate" },
];
export const RATE_BASIS = index(RATE_BASES);

export type Source =
  | "referral"
  | "job_board"
  | "linkedin"
  | "career_site"
  | "agency"
  | "event"
  | "inbound"
  | "sourced"
  | "rehire";

export const SOURCES: Meta<Source>[] = [
  { value: "referral", label: "Employee referral", tone: "emerald" },
  { value: "linkedin", label: "LinkedIn", tone: "blue" },
  { value: "job_board", label: "Job board", tone: "cyan" },
  { value: "career_site", label: "Career site", tone: "indigo" },
  { value: "sourced", label: "Outbound sourcing", tone: "violet" },
  { value: "agency", label: "Agency partner", tone: "amber" },
  { value: "event", label: "Event / meetup", tone: "orange" },
  { value: "inbound", label: "Inbound", tone: "slate" },
  { value: "rehire", label: "Boomerang", tone: "neutral" },
];
export const SOURCE = index(SOURCES);

/**
 * Work authorization (§5, §6).
 *
 * One vocabulary, read from both ends: a candidate holds exactly one of these,
 * and a requirement lists the ones its client will accept. Matching is then a
 * set membership test rather than free text on either side.
 */
export type WorkAuthorization =
  | "citizen"
  | "green_card"
  | "h1b"
  | "ead"
  | "opt_cpt"
  | "tn"
  | "requires_sponsorship";

export const WORK_AUTHORIZATIONS: Meta<WorkAuthorization>[] = [
  { value: "citizen", label: "US Citizen", tone: "emerald" },
  { value: "green_card", label: "Green Card", tone: "emerald" },
  { value: "h1b", label: "H-1B", tone: "blue" },
  { value: "ead", label: "EAD", tone: "cyan", description: "H4-EAD, L2-EAD or similar" },
  { value: "opt_cpt", label: "OPT / CPT", tone: "violet" },
  { value: "tn", label: "TN", tone: "indigo" },
  { value: "requires_sponsorship", label: "Needs sponsorship", tone: "amber" },
];
export const WORK_AUTHORIZATION = index(WORK_AUTHORIZATIONS);

/**
 * Does this candidate's authorization satisfy the requirement?
 * An empty list on the requirement means the client has set no constraint.
 */
export function visaMatches(accepted: string[] | null | undefined, held: string) {
  if (!accepted || accepted.length === 0) return true;
  return accepted.includes(held);
}

/* ------------------------------------------------------------------ *
 * Interviews
 * ------------------------------------------------------------------ */

export type InterviewType =
  | "phone_screen"
  | "technical"
  | "system_design"
  | "behavioral"
  | "panel"
  | "hiring_manager"
  | "client"
  | "final";

export const INTERVIEW_TYPES: Meta<InterviewType>[] = [
  { value: "phone_screen", label: "Phone screen", tone: "cyan" },
  { value: "technical", label: "Technical", tone: "violet" },
  { value: "system_design", label: "System design", tone: "indigo" },
  { value: "behavioral", label: "Behavioral", tone: "blue" },
  { value: "panel", label: "Panel", tone: "orange" },
  { value: "hiring_manager", label: "Hiring manager", tone: "amber" },
  { value: "client", label: "Client round", tone: "emerald" },
  { value: "final", label: "Final", tone: "rose" },
];
export const INTERVIEW_TYPE = index(INTERVIEW_TYPES);

export type InterviewStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export const INTERVIEW_STATUSES: Meta<InterviewStatus>[] = [
  { value: "scheduled", label: "Scheduled", tone: "blue", description: "Booked, not yet confirmed by everyone" },
  { value: "confirmed", label: "Confirmed", tone: "indigo", description: "Candidate and panel have both accepted" },
  { value: "completed", label: "Completed", tone: "emerald" },
  { value: "rescheduled", label: "Rescheduled", tone: "amber" },
  { value: "no_show", label: "No show", tone: "orange" },
  { value: "cancelled", label: "Cancelled", tone: "rose" },
];

/** Statuses that mean the interview is still ahead of the panel. */
export const PENDING_INTERVIEW_STATUSES: InterviewStatus[] = ["scheduled", "confirmed"];
export const INTERVIEW_STATUS = index(INTERVIEW_STATUSES);

export type InterviewMode = "video" | "phone" | "onsite";

export const INTERVIEW_MODES: Meta<InterviewMode>[] = [
  { value: "video", label: "Video", tone: "blue" },
  { value: "phone", label: "Phone", tone: "slate" },
  { value: "onsite", label: "Onsite", tone: "indigo" },
];
export const INTERVIEW_MODE = index(INTERVIEW_MODES);

export type Outcome = "strong_yes" | "yes" | "lean_yes" | "lean_no" | "no" | "strong_no" | "pending";

export const OUTCOMES: Meta<Outcome>[] = [
  { value: "strong_yes", label: "Strong yes", tone: "emerald" },
  { value: "yes", label: "Yes", tone: "emerald" },
  { value: "lean_yes", label: "Lean yes", tone: "cyan" },
  { value: "pending", label: "Awaiting", tone: "neutral" },
  { value: "lean_no", label: "Lean no", tone: "orange" },
  { value: "no", label: "No", tone: "rose" },
  { value: "strong_no", label: "Strong no", tone: "rose" },
];
export const OUTCOME = index(OUTCOMES);

export type Recommendation =
  | "strong_hire"
  | "hire"
  | "lean_hire"
  | "maybe"
  | "lean_no_hire"
  | "no_hire";

/**
 * The recommendation scale (§11), with an explicit **Maybe** midpoint.
 *
 * Without one, an interviewer who genuinely cannot call it has to round up or
 * down, and the rounding is invisible afterwards. Maybe scores zero, so it
 * moves the panel average towards undecided rather than pretending to a lean.
 */
export const RECOMMENDATIONS: Meta<Recommendation>[] = [
  { value: "strong_hire", label: "Strong hire", tone: "emerald" },
  { value: "hire", label: "Hire", tone: "emerald" },
  { value: "lean_hire", label: "Lean hire", tone: "cyan" },
  { value: "maybe", label: "Maybe", tone: "slate", description: "Genuinely undecided — needs another signal" },
  { value: "lean_no_hire", label: "Lean no hire", tone: "orange" },
  { value: "no_hire", label: "No hire", tone: "rose" },
];
export const RECOMMENDATION = index(RECOMMENDATIONS);

export const RECOMMENDATION_SCORE: Record<Recommendation, number> = {
  strong_hire: 2,
  hire: 1,
  lean_hire: 0.5,
  maybe: 0,
  lean_no_hire: -1,
  no_hire: -2,
};

/* ------------------------------------------------------------------ *
 * Scorecards (§11)
 * ------------------------------------------------------------------ */

/**
 * The default scorecard.
 *
 * Templates live in the database (`scorecard_templates`) so they are editable
 * per role; this is what the seed installs and what a panel falls back to when
 * a requirement names no template. Scores are stored as a keyed map, so adding
 * a competency is a template edit rather than a migration.
 */
export const DEFAULT_COMPETENCIES = [
  { key: "technical", label: "Technical depth", description: "Command of the craft this role needs" },
  { key: "problem_solving", label: "Problem solving", description: "How they break down something unfamiliar" },
  { key: "communication", label: "Communication", description: "Clarity, listening, and writing" },
  { key: "ownership", label: "Ownership", description: "What they take responsibility for without being asked" },
  { key: "collaboration", label: "Collaboration", description: "How they work with people who disagree" },
  { key: "culture_fit", label: "Values alignment", description: "Fit with how this team actually operates" },
] as const;

/** Kept for the few places that still want a flat list of the default keys. */
export const FEEDBACK_COMPETENCIES = DEFAULT_COMPETENCIES;

/* ------------------------------------------------------------------ *
 * Feedback SLA (§10)
 * ------------------------------------------------------------------ */

export type FeedbackStatus = "pending" | "submitted" | "declined";

export const FEEDBACK_STATUSES: Meta<FeedbackStatus>[] = [
  { value: "pending", label: "Pending", tone: "amber" },
  { value: "submitted", label: "Submitted", tone: "emerald" },
  { value: "declined", label: "Declined", tone: "slate", description: "Did not attend, or stood down" },
];
export const FEEDBACK_STATUS = index(FEEDBACK_STATUSES);

/** Hours after an interview ends before its scorecard is considered late. */
export const FEEDBACK_SLA_HOURS = 24;

/**
 * How overdue a scorecard is, in the buckets the spec asks to report on.
 * `null` means it is not late yet.
 */
export const OVERDUE_BUCKETS = [24, 48, 72] as const;
export type OverdueBucket = (typeof OVERDUE_BUCKETS)[number] | "72_plus";

export function overdueBucket(hoursLate: number): OverdueBucket | null {
  if (hoursLate <= 0) return null;
  if (hoursLate <= 24) return 24;
  if (hoursLate <= 48) return 48;
  if (hoursLate <= 72) return 72;
  return "72_plus";
}

export const OVERDUE_BUCKET_LABEL: Record<OverdueBucket, string> = {
  24: "Up to 24h late",
  48: "24–48h late",
  72: "48–72h late",
  "72_plus": "Over 72h late",
};

/* ------------------------------------------------------------------ *
 * Offers
 * ------------------------------------------------------------------ */

export type OfferStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "extended"
  | "accepted"
  | "declined"
  | "rescinded"
  | "expired";

export const OFFER_STATUSES: Meta<OfferStatus>[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "pending_approval", label: "Pending approval", tone: "amber" },
  { value: "approved", label: "Approved", tone: "cyan" },
  { value: "extended", label: "Extended", tone: "blue" },
  { value: "accepted", label: "Accepted", tone: "emerald" },
  { value: "declined", label: "Declined", tone: "rose" },
  { value: "rescinded", label: "Rescinded", tone: "rose" },
  { value: "expired", label: "Expired", tone: "slate" },
];
export const OFFER_STATUS = index(OFFER_STATUSES);

/** Legal forward transitions for an offer. Anything else is rejected. */
export const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  draft: ["pending_approval", "rescinded"],
  pending_approval: ["approved", "draft", "rescinded"],
  approved: ["extended", "rescinded"],
  extended: ["accepted", "declined", "expired", "rescinded"],
  accepted: ["rescinded"],
  declined: [],
  rescinded: [],
  expired: ["extended"],
};

export const DECLINE_REASONS = [
  "Accepted a competing offer",
  "Compensation below expectation",
  "Counter-offer from current employer",
  "Relocation / commute",
  "Role scope not a fit",
  "Personal circumstances",
] as const;

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

export type UserRole = "admin" | "recruiter" | "hiring_manager" | "coordinator" | "interviewer";

export const USER_ROLES: Meta<UserRole>[] = [
  { value: "admin", label: "Talent leadership", tone: "violet" },
  { value: "recruiter", label: "Recruiter", tone: "indigo" },
  { value: "hiring_manager", label: "Hiring manager", tone: "blue" },
  { value: "coordinator", label: "Coordinator", tone: "cyan" },
  { value: "interviewer", label: "Interviewer", tone: "slate" },
];
export const USER_ROLE = index(USER_ROLES);

export type ClientTier = "strategic" | "key" | "standard";

export const CLIENT_TIERS: Meta<ClientTier>[] = [
  { value: "strategic", label: "Strategic", tone: "violet" },
  { value: "key", label: "Key", tone: "indigo" },
  { value: "standard", label: "Standard", tone: "slate" },
];
export const CLIENT_TIER = index(CLIENT_TIERS);

/* ------------------------------------------------------------------ *
 * Activity feed
 * ------------------------------------------------------------------ */

export const ACTIVITY_TYPES = {
  requisition_created: { label: "Requisition opened", tone: "emerald" as Tone },
  requisition_updated: { label: "Requisition updated", tone: "blue" as Tone },
  requisition_status: { label: "Requisition status changed", tone: "amber" as Tone },
  candidate_created: { label: "Candidate added", tone: "cyan" as Tone },
  candidate_updated: { label: "Candidate updated", tone: "blue" as Tone },
  submission_created: { label: "Added to pipeline", tone: "indigo" as Tone },
  stage_changed: { label: "Stage advanced", tone: "violet" as Tone },
  submission_rejected: { label: "Candidate rejected", tone: "rose" as Tone },
  interview_scheduled: { label: "Interview scheduled", tone: "blue" as Tone },
  interview_completed: { label: "Interview completed", tone: "emerald" as Tone },
  interview_cancelled: { label: "Interview cancelled", tone: "rose" as Tone },
  feedback_submitted: { label: "Feedback submitted", tone: "violet" as Tone },
  offer_created: { label: "Offer drafted", tone: "amber" as Tone },
  offer_status: { label: "Offer status changed", tone: "amber" as Tone },
  note_added: { label: "Note added", tone: "slate" as Tone },
  attachment_added: { label: "File attached", tone: "cyan" as Tone },
  attachment_removed: { label: "File removed", tone: "slate" as Tone },
} as const;

export type ActivityType = keyof typeof ACTIVITY_TYPES;
