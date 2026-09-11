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

/** Every tone, for pickers that let someone choose one. */
export const TONES: Tone[] = [
  "neutral",
  "slate",
  "blue",
  "indigo",
  "violet",
  "amber",
  "emerald",
  "rose",
  "cyan",
  "orange",
];

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

/**
 * A pipeline stage key.
 *
 * Deliberately a plain string rather than a union: stages are rows an
 * administrator can add, rename and reorder (§8), so the set is not knowable at
 * compile time. What *is* fixed is the vocabulary of meanings below — code asks
 * "is this an interview stage?" rather than "is this key `interview_scheduled`?",
 * which is what lets a new stage work everywhere the moment it is created.
 */
export type Stage = string;

/**
 * What a stage *means*, as opposed to what it is called.
 *
 * This is the closed set. A custom stage is declared to be one of these, and
 * every rule in the application — when a submission counts as submitted, which
 * stages the interview sync owns, how a requirement reads its own progress —
 * is written against the kind rather than against a key someone can rename.
 */
export type StageKind =
  | "sourcing"
  | "submitted"
  | "interviewing"
  | "offer"
  | "placement"
  | "terminal";

export const STAGE_KINDS: Meta<StageKind>[] = [
  { value: "sourcing", label: "Sourcing", tone: "cyan", description: "Ours to work — the client has not seen them" },
  { value: "submitted", label: "With the client", tone: "blue", description: "Submitted and under review" },
  { value: "interviewing", label: "Interviewing", tone: "violet", description: "In the loop, or waiting on its outcome" },
  { value: "offer", label: "Deciding", tone: "amber", description: "Selected, or at offer" },
  { value: "placement", label: "Placed", tone: "emerald", description: "The end of a successful pipeline" },
  { value: "terminal", label: "Closed out", tone: "slate", description: "Not moving: rejected, withdrawn or on hold" },
];
export const STAGE_KIND = index(STAGE_KINDS);

/** The order the live kinds occur in. Terminal is not part of the progression. */
export const KIND_ORDER: StageKind[] = [
  "sourcing",
  "submitted",
  "interviewing",
  "offer",
  "placement",
];

export interface StageDef {
  key: Stage;
  label: string;
  kind: StageKind;
  tone: Tone;
  description: string;
  /** Days before a submission sitting here is "aging". 0 means never. */
  slaDays: number;
  position: number;
  active: boolean;
}

/**
 * The stages the specification asks for (§8), used to seed the table and as the
 * fallback if it is empty. After seeding the database is the authority; nothing
 * reads this list at request time except as a last resort.
 *
 * SLAs are tight where a stage is a handover to somebody else (Client Review,
 * Feedback Pending), because that is where pipelines silently stall.
 */
export const DEFAULT_STAGES: StageDef[] = [
  { key: "new", label: "New", kind: "sourcing", tone: "slate", description: "In the pipeline, not yet worked", slaDays: 3, position: 0, active: true },
  { key: "screening", label: "Screening", kind: "sourcing", tone: "cyan", description: "Recruiter screen in progress", slaDays: 4, position: 1, active: true },
  { key: "qualified", label: "Qualified", kind: "sourcing", tone: "cyan", description: "Screened and fit for the requirement", slaDays: 3, position: 2, active: true },
  { key: "submitted", label: "Submitted", kind: "submitted", tone: "blue", description: "Profile sent to the client", slaDays: 4, position: 3, active: true },
  { key: "client_review", label: "Client Review", kind: "submitted", tone: "indigo", description: "With the client for a decision", slaDays: 5, position: 4, active: true },
  { key: "interview_scheduled", label: "Interview Scheduled", kind: "interviewing", tone: "violet", description: "Interview booked and confirmed", slaDays: 7, position: 5, active: true },
  { key: "interview_completed", label: "Interview Completed", kind: "interviewing", tone: "violet", description: "Interview done, decision pending", slaDays: 3, position: 6, active: true },
  { key: "feedback_pending", label: "Feedback Pending", kind: "interviewing", tone: "orange", description: "Waiting on interviewer feedback", slaDays: 2, position: 7, active: true },
  { key: "selected", label: "Selected", kind: "offer", tone: "amber", description: "Chosen by the client, pre-offer", slaDays: 4, position: 8, active: true },
  { key: "offer", label: "Offer", kind: "offer", tone: "amber", description: "Offer drafted, approved or extended", slaDays: 7, position: 9, active: true },
  { key: "joined", label: "Joined", kind: "placement", tone: "emerald", description: "Started in the role", slaDays: 0, position: 10, active: true },
];

/**
 * Where a submission stopped.
 *
 * Terminal stages sit outside the ordered pipeline and are not configurable:
 * each one means something the application itself acts on, so adding a fourth
 * would be adding a rule, not a column on a board.
 */
export const TERMINAL_STAGES: StageDef[] = [
  { key: "rejected", label: "Rejected", kind: "terminal", tone: "rose", description: "We or the client passed", slaDays: 0, position: 100, active: true },
  { key: "withdrawn", label: "Withdrawn", kind: "terminal", tone: "neutral", description: "The candidate stepped away", slaDays: 0, position: 101, active: true },
  { key: "on_hold", label: "On hold", kind: "terminal", tone: "amber", description: "Parked, expected back", slaDays: 0, position: 102, active: true },
];

export const TERMINAL_KEYS = TERMINAL_STAGES.map((s) => s.key);

export function isTerminal(stage: Stage) {
  return TERMINAL_KEYS.includes(stage);
}

/**
 * A resolved set of stages, with every lookup the rest of the application needs.
 *
 * Built once from whatever the database holds and passed around, rather than
 * each caller re-deriving the same maps from a list.
 */
export class Pipeline {
  readonly all: StageDef[];
  readonly live: StageDef[];
  readonly terminal: StageDef[];
  private readonly byKey: Map<Stage, StageDef>;

  constructor(stages: StageDef[]) {
    const live = stages
      .filter((st) => st.kind !== "terminal" && st.active)
      .sort((a, b) => a.position - b.position);
    // A pipeline with no stages cannot be rendered or reasoned about, so an
    // empty or entirely disabled configuration falls back rather than breaking.
    this.live = live.length ? live : DEFAULT_STAGES;
    this.terminal = TERMINAL_STAGES;
    this.all = [...this.live, ...this.terminal];
    this.byKey = new Map(this.all.map((st) => [st.key, st]));
  }

  /** Never undefined: an unknown key renders as itself rather than as a blank. */
  get(stage: Stage): StageDef {
    return (
      this.byKey.get(stage) ?? {
        key: stage,
        label: stage.replace(/_/g, " "),
        kind: "sourcing",
        tone: "neutral",
        description: "",
        slaDays: 0,
        position: -1,
        active: false,
      }
    );
  }

  get order(): Stage[] {
    return this.live.map((st) => st.key);
  }

  /** Everything before placement — what the board shows as columns. */
  get active(): Stage[] {
    return this.live.filter((st) => st.kind !== "placement").map((st) => st.key);
  }

  index(stage: Stage) {
    return this.live.findIndex((st) => st.key === stage);
  }

  kind(stage: Stage): StageKind {
    return this.get(stage).kind;
  }

  label(stage: Stage) {
    return this.get(stage).label;
  }

  sla(stage: Stage) {
    return this.get(stage).slaDays;
  }

  ofKind(kind: StageKind): Stage[] {
    return this.live.filter((st) => st.kind === kind).map((st) => st.key);
  }

  /**
   * The stage a candidate enters when they reach this phase.
   *
   * Used wherever the application has to *put* someone somewhere, and by funnel
   * analytics, which counts entry into a phase exactly once.
   */
  entryOf(kind: StageKind): Stage {
    return this.ofKind(kind)[0] ?? this.live[0]!.key;
  }

  /** The last stage of a phase — where someone rests before the next decision. */
  lastOf(kind: StageKind): Stage {
    const list = this.ofKind(kind);
    return list[list.length - 1] ?? this.live[0]!.key;
  }

  /** True once a submission has reached the given phase. Terminal is never "past". */
  atOrPastKind(stage: Stage, kind: StageKind) {
    if (isTerminal(stage)) return false;
    const here = KIND_ORDER.indexOf(this.kind(stage));
    const mark = KIND_ORDER.indexOf(kind);
    return here >= 0 && mark >= 0 && here >= mark;
  }

  /** True once a submission has reached the given stage, by position. */
  atOrPast(stage: Stage, mark: Stage) {
    const here = this.index(stage);
    const there = this.index(mark);
    return here >= 0 && there >= 0 && here >= there;
  }

  /** The bucket a live stage summarises into on a requirement card. */
  bucket(stage: Stage): keyof StageCounts | null {
    switch (this.kind(stage)) {
      case "sourcing":
        return "sourcing";
      case "submitted":
        return "submitted";
      case "interviewing":
        return "interviewing";
      case "offer":
        return "offer";
      default:
        return null;
    }
  }
}

/** The built-in pipeline, for tests and for code with no database to hand. */
export const DEFAULT_PIPELINE = new Pipeline(DEFAULT_STAGES);

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
  candidate_merged: { label: "Records merged", tone: "violet" as Tone },
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
  settings_changed: { label: "Settings changed", tone: "violet" as Tone },
  signed_in: { label: "Signed in", tone: "neutral" as Tone },
} as const;

export type ActivityType = keyof typeof ACTIVITY_TYPES;
