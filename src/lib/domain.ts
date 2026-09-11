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
  | "sourced"
  | "screening"
  | "submitted"
  | "interview"
  | "offer"
  | "hired"
  | "rejected"
  | "withdrawn";

/** Stages a submission passes through, in order. Terminal states excluded. */
export const PIPELINE_STAGES: Meta<Stage>[] = [
  { value: "sourced", label: "Sourced", tone: "slate", description: "Identified and being qualified" },
  { value: "screening", label: "Screening", tone: "cyan", description: "Recruiter screen in progress" },
  { value: "submitted", label: "Submitted", tone: "blue", description: "Profile sent to hiring manager" },
  { value: "interview", label: "Interview", tone: "violet", description: "In the interview loop" },
  { value: "offer", label: "Offer", tone: "amber", description: "Offer drafted, approved or extended" },
  { value: "hired", label: "Hired", tone: "emerald", description: "Offer accepted and start date set" },
];

export const TERMINAL_STAGES: Meta<Stage>[] = [
  { value: "rejected", label: "Rejected", tone: "rose" },
  { value: "withdrawn", label: "Withdrawn", tone: "neutral" },
];

export const ALL_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES];
export const STAGE = index(ALL_STAGES);
export const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.value);

/** Stages that still count as live pipeline (not hired, not closed out). */
export const ACTIVE_STAGES: Stage[] = ["sourced", "screening", "submitted", "interview", "offer"];

/** Target days a submission should spend in a stage before it is "aging". */
export const STAGE_SLA_DAYS: Record<Stage, number> = {
  sourced: 5,
  screening: 4,
  submitted: 5,
  interview: 10,
  offer: 7,
  hired: 0,
  rejected: 0,
  withdrawn: 0,
};

export function stageIndex(stage: Stage) {
  return STAGE_ORDER.indexOf(stage);
}

/* ------------------------------------------------------------------ *
 * Submission status
 * ------------------------------------------------------------------ */

export type SubmissionStatus = "active" | "hired" | "rejected" | "withdrawn" | "on_hold";

export const SUBMISSION_STATUSES: Meta<SubmissionStatus>[] = [
  { value: "active", label: "Active", tone: "blue" },
  { value: "on_hold", label: "On hold", tone: "amber" },
  { value: "hired", label: "Hired", tone: "emerald" },
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

export type ReqStatus = "draft" | "open" | "on_hold" | "filled" | "cancelled" | "closed";

export const REQ_STATUSES: Meta<ReqStatus>[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "open", label: "Open", tone: "emerald" },
  { value: "on_hold", label: "On hold", tone: "amber" },
  { value: "filled", label: "Filled", tone: "indigo" },
  { value: "closed", label: "Closed", tone: "slate" },
  { value: "cancelled", label: "Cancelled", tone: "rose" },
];
export const REQ_STATUS = index(REQ_STATUSES);

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

export type EmploymentType = "full_time" | "contract" | "contract_to_hire" | "part_time" | "intern";

export const EMPLOYMENT_TYPES: Meta<EmploymentType>[] = [
  { value: "full_time", label: "Full-time", tone: "indigo" },
  { value: "contract", label: "Contract", tone: "cyan" },
  { value: "contract_to_hire", label: "Contract-to-hire", tone: "violet" },
  { value: "part_time", label: "Part-time", tone: "slate" },
  { value: "intern", label: "Internship", tone: "neutral" },
];
export const EMPLOYMENT_TYPE = index(EMPLOYMENT_TYPES);

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

export const WORK_AUTHORIZATIONS = [
  { value: "citizen", label: "Citizen" },
  { value: "permanent_resident", label: "Permanent resident" },
  { value: "visa_holder", label: "Visa holder" },
  { value: "requires_sponsorship", label: "Requires sponsorship" },
] as const;

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

export type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";

export const INTERVIEW_STATUSES: Meta<InterviewStatus>[] = [
  { value: "scheduled", label: "Scheduled", tone: "blue" },
  { value: "completed", label: "Completed", tone: "emerald" },
  { value: "rescheduled", label: "Rescheduled", tone: "amber" },
  { value: "no_show", label: "No show", tone: "orange" },
  { value: "cancelled", label: "Cancelled", tone: "rose" },
];
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

export type Recommendation = "strong_hire" | "hire" | "lean_hire" | "lean_no_hire" | "no_hire";

export const RECOMMENDATIONS: Meta<Recommendation>[] = [
  { value: "strong_hire", label: "Strong hire", tone: "emerald" },
  { value: "hire", label: "Hire", tone: "emerald" },
  { value: "lean_hire", label: "Lean hire", tone: "cyan" },
  { value: "lean_no_hire", label: "Lean no hire", tone: "orange" },
  { value: "no_hire", label: "No hire", tone: "rose" },
];
export const RECOMMENDATION = index(RECOMMENDATIONS);

export const RECOMMENDATION_SCORE: Record<Recommendation, number> = {
  strong_hire: 2,
  hire: 1,
  lean_hire: 0.5,
  lean_no_hire: -1,
  no_hire: -2,
};

export const FEEDBACK_COMPETENCIES = [
  { key: "technical", label: "Technical depth" },
  { key: "problemSolving", label: "Problem solving" },
  { key: "communication", label: "Communication" },
  { key: "cultureFit", label: "Values alignment" },
] as const;

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
} as const;

export type ActivityType = keyof typeof ACTIVITY_TYPES;
