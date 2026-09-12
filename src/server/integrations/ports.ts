import "server-only";

/**
 * Integration ports (§22).
 *
 * "Do not hard-code the architecture around any one external provider."
 *
 * Three things this application will eventually need to do outside itself:
 * put an interview in people's calendars, send an email, and publish a
 * requirement to a job board. Each is defined here as an interface with a
 * no-op default, for a specific reason rather than as ceremony.
 *
 * Defining a port *before* the integration exists is the cheap moment. Once
 * calendar logic is written inline in `scheduleInterview`, moving it costs a
 * refactor of the action, its tests and its error handling; today it costs
 * one interface. The ports are also where the awkward realities live —
 * idempotency keys, partial failure, the fact that a calendar invite can
 * succeed while the email bounces — and those are much easier to design for
 * in the abstract than to retrofit around a working Google Calendar call.
 *
 * The no-op defaults are honest: nothing is sent, every method says so, and
 * the application behaves correctly without any of them configured. A port
 * that silently pretended to succeed would be worse than none.
 */

export interface DeliveryResult {
  /** False when the provider declined or is not configured. */
  sent: boolean;
  /** The provider's own id, for reconciliation and for not sending twice. */
  externalId?: string;
  /** Why not, in words a person could act on. */
  reason?: string;
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

export interface CalendarEvent {
  /** Ours. A provider must treat two calls with the same key as one event. */
  idempotencyKey: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  /** IANA zone the event was booked in. */
  timezone: string;
  location: string | null;
  organiserEmail: string;
  attendeeEmails: string[];
}

export interface CalendarPort {
  readonly name: string;
  create(event: CalendarEvent): Promise<DeliveryResult>;
  update(externalId: string, event: CalendarEvent): Promise<DeliveryResult>;
  cancel(externalId: string, reason: string): Promise<DeliveryResult>;
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

export interface EmailMessage {
  idempotencyKey: string;
  to: string[];
  subject: string;
  /** Plain text. HTML is a provider concern, not this application's. */
  body: string;
  replyTo?: string;
}

export interface EmailPort {
  readonly name: string;
  send(message: EmailMessage): Promise<DeliveryResult>;
}

/* ------------------------------------------------------------------ *
 * Job boards
 * ------------------------------------------------------------------ */

export interface JobPosting {
  idempotencyKey: string;
  title: string;
  description: string;
  location: string;
  workMode: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  skills: string[];
}

export interface JobBoardPort {
  readonly name: string;
  publish(posting: JobPosting): Promise<DeliveryResult>;
  unpublish(externalId: string): Promise<DeliveryResult>;
}

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

const notConfigured = (what: string): DeliveryResult => ({
  sent: false,
  reason: `No ${what} provider is configured, so nothing was sent.`,
});

const noCalendar: CalendarPort = {
  name: "none",
  async create() {
    return notConfigured("calendar");
  },
  async update() {
    return notConfigured("calendar");
  },
  async cancel() {
    return notConfigured("calendar");
  },
};

const noEmail: EmailPort = {
  name: "none",
  async send() {
    return notConfigured("email");
  },
};

const noJobBoard: JobBoardPort = {
  name: "none",
  async publish() {
    return notConfigured("job board");
  },
  async unpublish() {
    return notConfigured("job board");
  },
};

/**
 * The single place a provider is chosen, mirroring the attachment store and
 * the AI provider. A real integration branches on an environment variable
 * here and nowhere else.
 */
export function calendar(): CalendarPort {
  return noCalendar;
}

export function email(): EmailPort {
  return noEmail;
}

export function jobBoard(): JobBoardPort {
  return noJobBoard;
}

/** What the settings screen reports about outbound integrations. */
export function integrationStatus() {
  return [
    {
      key: "calendar",
      label: "Calendar",
      provider: calendar().name,
      purpose: "Put interviews in the panel's calendars and keep them in step when a round moves.",
    },
    {
      key: "email",
      label: "Email",
      provider: email().name,
      purpose: "Send notifications outside the app, and confirmations to candidates.",
    },
    {
      key: "job_board",
      label: "Job boards",
      provider: jobBoard().name,
      purpose: "Publish an open requirement and take it down when it is filled.",
    },
  ];
}
