/**
 * The permission catalogue and the default role matrix.
 *
 * Permissions are declared here but *stored* in the database, because the
 * specification requires an administrator to be able to reconfigure the
 * matrix. This file is the seed and the type source; the database is the
 * runtime authority. If the two disagree, the database wins.
 *
 * Scope is encoded in the permission itself (`requisition.view.all` versus
 * `requisition.view.assigned`) rather than in a separate dimension. That
 * keeps every decision a single boolean lookup, which is far easier to audit
 * than a rules engine, and makes the matrix readable at a glance.
 */

export interface PermissionDef {
  key: string;
  label: string;
  category: string;
  description: string;
  /** Exposes candidate personal data — surfaced separately for review (§23). */
  sensitive?: boolean;
}

export const PERMISSIONS = [
  /* ---- Requirements ---- */
  { key: "requisition.view.all", label: "View all requirements", category: "Requirements", description: "See every requirement in the organisation." },
  { key: "requisition.view.assigned", label: "View assigned requirements", category: "Requirements", description: "See only requirements where the user is lead recruiter, hiring manager or an assignee." },
  { key: "requisition.create", label: "Create requirements", category: "Requirements", description: "Open a new requirement." },
  { key: "requisition.edit", label: "Edit requirements", category: "Requirements", description: "Change requirement details, including the salary band." },
  { key: "requisition.status", label: "Change requirement status", category: "Requirements", description: "Put on hold, close, cancel or reopen." },
  { key: "requisition.assign", label: "Assign recruiters", category: "Requirements", description: "Add or remove people from a requirement team." },

  /* ---- Candidates ---- */
  { key: "candidate.view.all", label: "View all candidates", category: "Candidates", description: "Browse the whole talent pool." },
  { key: "candidate.view.owned", label: "View owned candidates", category: "Candidates", description: "See only candidates the user owns or has in a pipeline they work." },
  { key: "candidate.pii", label: "View candidate contact details", category: "Candidates", description: "Email, phone and compensation. Redacted without this.", sensitive: true },
  { key: "candidate.create", label: "Add candidates", category: "Candidates", description: "Create a candidate record." },
  { key: "candidate.edit", label: "Edit candidates", category: "Candidates", description: "Change candidate details." },

  /* ---- Pipeline ---- */
  { key: "submission.create", label: "Add to a pipeline", category: "Pipeline", description: "Put a candidate forward for a requirement." },
  { key: "submission.move", label: "Move pipeline stage", category: "Pipeline", description: "Advance or move a candidate back through the pipeline." },
  { key: "submission.close", label: "Close candidates out", category: "Pipeline", description: "Reject or record a withdrawal." },

  /* ---- Interviews ---- */
  { key: "interview.view.all", label: "View all interviews", category: "Interviews", description: "See the whole interview schedule." },
  { key: "interview.view.own", label: "View own interviews", category: "Interviews", description: "See only interviews the user is on the panel for." },
  { key: "interview.schedule", label: "Schedule interviews", category: "Interviews", description: "Book a round and assemble a panel." },
  { key: "interview.cancel", label: "Cancel interviews", category: "Interviews", description: "Cancel or reschedule a booked round." },
  { key: "feedback.submit", label: "Submit feedback", category: "Interviews", description: "Complete a scorecard for a round the user sat on." },
  { key: "feedback.view.all", label: "View all feedback", category: "Interviews", description: "Read scorecards written by other interviewers." },

  /* ---- Offers ---- */
  { key: "offer.view", label: "View offers", category: "Offers", description: "See offer terms and status." },
  { key: "offer.create", label: "Draft offers", category: "Offers", description: "Create an offer for a candidate at offer stage." },
  { key: "offer.edit", label: "Edit offer terms", category: "Offers", description: "Revise compensation before approval." },
  { key: "offer.approve", label: "Approve offers", category: "Offers", description: "Sign off an offer for extension." },
  { key: "offer.transition", label: "Progress offers", category: "Offers", description: "Extend, accept, decline or rescind." },

  /* ---- Clients, team, reporting ---- */
  { key: "client.view", label: "View client accounts", category: "Clients", description: "See client accounts and their demand." },
  { key: "client.manage", label: "Manage client accounts", category: "Clients", description: "Create and edit client accounts." },
  { key: "team.view", label: "View the team", category: "Team", description: "See recruiters, workload and interviewer load." },
  { key: "team.manage", label: "Manage the team", category: "Team", description: "Invite people, change roles and capacity." },
  { key: "report.view", label: "View reports", category: "Reporting", description: "Open dashboards and hiring analytics." },
  { key: "report.export", label: "Export reports", category: "Reporting", description: "Download report data." },
  { key: "audit.view", label: "View the audit trail", category: "Governance", description: "Read the full activity and change history." },
  { key: "settings.manage", label: "Manage settings", category: "Governance", description: "Configure roles, permissions and pipeline stages." },

  /* ---- Notes ---- */
  { key: "note.create", label: "Add notes", category: "Collaboration", description: "Comment on requirements, candidates and submissions." },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as PermissionKey[];

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

export interface RoleDef {
  key: string;
  label: string;
  description: string;
  /** Lower is more privileged. */
  rank: number;
  permissions: readonly PermissionKey[];
}

const ALL = PERMISSION_KEYS;

/** Everything a recruiter does day to day, on their own desk. */
const RECRUITER_CORE = [
  "requisition.view.assigned",
  "requisition.create",
  "requisition.edit",
  "requisition.status",
  "candidate.view.all",
  "candidate.pii",
  "candidate.create",
  "candidate.edit",
  "submission.create",
  "submission.move",
  "submission.close",
  "interview.view.all",
  "interview.schedule",
  "interview.cancel",
  "feedback.view.all",
  "offer.view",
  "offer.create",
  "offer.edit",
  "offer.transition",
  "client.view",
  "team.view",
  "report.view",
  "note.create",
] as const satisfies readonly PermissionKey[];

export const ROLES: readonly RoleDef[] = [
  {
    key: "super_admin",
    label: "Super Admin",
    description: "Unrestricted access, including role and permission configuration.",
    rank: 0,
    permissions: ALL,
  },
  {
    key: "recruitment_manager",
    label: "Recruitment Manager",
    description: "Runs the whole recruiting organisation: every requirement, every desk, plus offer approval.",
    rank: 10,
    permissions: ALL.filter((p) => p !== "settings.manage"),
  },
  {
    key: "recruiter",
    label: "Recruiter",
    description: "Owns assigned requirements end to end, from sourcing through offer.",
    rank: 20,
    permissions: RECRUITER_CORE,
  },
  {
    key: "sourcer",
    label: "Sourcer",
    description: "Builds and qualifies top of funnel. Cannot submit to clients or touch offers.",
    rank: 30,
    permissions: [
      "requisition.view.assigned",
      "candidate.view.all",
      "candidate.pii",
      "candidate.create",
      "candidate.edit",
      "submission.create",
      "interview.view.own",
      "team.view",
      "note.create",
    ],
  },
  {
    key: "hiring_manager",
    label: "Hiring Manager",
    description: "Owns the hiring decision for their requirements. Reviews submissions and approves offers.",
    rank: 25,
    permissions: [
      "requisition.view.assigned",
      "requisition.create",
      "requisition.status",
      "candidate.view.all",
      "candidate.pii",
      "submission.move",
      "submission.close",
      "interview.view.all",
      "interview.schedule",
      "feedback.submit",
      "feedback.view.all",
      "offer.view",
      "offer.approve",
      "client.view",
      "team.view",
      "report.view",
      "note.create",
    ],
  },
  {
    key: "interviewer",
    label: "Interviewer",
    description: "Sees the interviews they are on the panel for and submits scorecards. Nothing else.",
    rank: 40,
    permissions: ["interview.view.own", "feedback.submit", "note.create"],
  },
  {
    key: "readonly_management",
    label: "Read-only Management",
    description: "Dashboards and analytics only. No candidate contact details, no writes.",
    rank: 15,
    permissions: [
      "requisition.view.all",
      "candidate.view.all",
      "interview.view.all",
      "offer.view",
      "client.view",
      "team.view",
      "report.view",
      "report.export",
    ],
  },
];

export const ROLE_KEYS = ROLES.map((r) => r.key);
export type RoleKey = (typeof ROLES)[number]["key"];

export function roleDef(key: string) {
  return ROLES.find((r) => r.key === key);
}

/**
 * Permissions that grant a *narrower* version of another permission. Used to
 * resolve scope: holding `requisition.view.all` implies the assigned variant.
 */
export const SCOPE_FALLBACK: Partial<Record<PermissionKey, PermissionKey>> = {
  "requisition.view.assigned": "requisition.view.all",
  "candidate.view.owned": "candidate.view.all",
  "interview.view.own": "interview.view.all",
};
