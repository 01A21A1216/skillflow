# Recruitment Command Center

A centralised applicant tracking and recruiting-operations platform: open requirements,
recruiters, candidates, submissions, interviews, feedback, offers and hiring analytics in
one system.

It is built as an internal tool for a talent team that actually runs a desk — the home
screen answers "what needs me today?", not "here are some numbers" — and it ships with a
simulated recruiting organisation so every screen has real, self-consistent data behind it.

```bash
npm install
npm run db:up      # start Postgres in Docker (port 5433)
npm run db:reset   # create the schema and load the sample organisation
npm run dev        # http://localhost:3000
```

Postgres runs on **5433**, not the default 5432, so this project never collides
with another database already running on your machine.

---

## What is in it

| Area | What it does |
|---|---|
| **Dashboard** | Eight operational KPIs, a ranked action queue (overdue scorecards, expiring offers, stalled candidates, at-risk requisitions), the 180-day conversion funnel, throughput small multiples, live pipeline composition, requisitions needing attention, and a team activity feed. |
| **Requisitions** | Filterable register with a derived **health** verdict per requisition, inline pipeline composition, openings filled, target-date tracking. Full detail view with an embedded drag-and-drop board, interviews, offers, close-out reasons, the brief, the working team and stage SLAs. |
| **Pipeline** | Global kanban across the eleven specified stages. Drag a candidate between stages and the move is written to their timeline, with optimistic repaint and a toast. Per-card actions for advancing, scheduling a loop, drafting an offer, parking on hold or closing out. Cards carry the candidate's work authorization and flag anyone the client will not accept. |
| **Candidates** | Searchable talent pool with skill, seniority, source, ownership, work-authorisation and pipeline-state facets. Profiles show every requisition they have touched, the full interview history with scorecards, offers, an averaged competency chart and notes. |
| **Interviews** | Schedule grouped by day, panel composition with per-panelist feedback status, an "awaiting feedback" queue, and scorecard submission. Once every panelist has submitted, the round outcome settles automatically from the balance of recommendations. |
| **Offers** | Offer register with a legal-transition state machine, position against the approved salary band, total compensation, expiry tracking, decline-reason capture and acceptance-rate trend. |
| **Analytics** | Funnel with per-step conversion, stage velocity, time-to-fill and time-to-hire, 12-month throughput, source effectiveness, recruiter performance, pipeline aging, close-out reasons, interview operations and interviewer load. |
| **Team / Clients** | Recruiter capacity and utilisation, interviewer load and feedback debt; client accounts with demand, coverage and fill rate. |
| **Assistant** | Ask a question in English — "who is waiting on client feedback", "senior Oracle DBAs available in two weeks" — and get the answer as rows you can open. The question becomes a structured query executed through the same scoped functions the pages use, so it cannot return anything you could not have navigated to. |
| **Matching** | Candidate-to-requirement scoring across seven weighted factors that sum to 100, each one showing its own verdict and the evidence for it. Explainable by construction: there is no score without a reason beside it. |
| **Parsing** | A resume or a job description becomes a filled-in form, field by field, each with a confidence and the text it came from. Only confident fields are pre-filled; everything runs in-process, so a CV is never sent anywhere. |
| **Notifications** | Fourteen triggers, deduplicated per person per fact, with an inbox. The four that report an *absence* — feedback that has not arrived, a requirement that is not filling, a candidate nobody has touched — run as scheduled jobs rather than on a page render. |
| **Reports** | Twelve report definitions with CSV export, sharing their rows with the screens that chart them, so an export can never disagree with the picture above it. |
| **Settings** | Pipeline stages, scorecard templates and the permission matrix, all editable in-app; plus background-job health and the retention policy. |
| **Live updates** | Changes made by anybody appear on everybody's open screen, over SSE and Postgres `LISTEN`/`NOTIFY`. |
| **Access control** | Sign-in, sessions, and the seven specified roles with a configurable permission matrix. What each person sees and can do is decided in the query and action layers, not the UI. |
| **Data integrity** | Structured change history (field, before, after), soft delete with recovery, and optimistic concurrency so two recruiters editing one record cannot silently overwrite each other. |
| **Privacy** | Subject-access export, erasure that is not soft delete, and a retention policy applied daily. |

Cross-cutting: ⌘K global search, URL-driven filters (every view is shareable and
survives a reload), light/dark themes, and an audit trail that attributes every write to
the signed-in person.

### Signing in

`npm run db:reset` creates one account per role, all with the password `demo1234`. The
sign-in page lists them in development and never in production. Signing in as different
roles is the quickest way to see access control working:

| Role | Account | What they see |
|---|---|---|
| Super Admin | `dana.whitfield@meridiantalent.com` | Everything, including settings |
| Recruitment Manager | `marcus.ellery@meridiantalent.com` | The whole organisation; approves offers |
| Recruiter | `priya.raghavan@meridiantalent.com` | Only their assigned requirements |
| Sourcer | `tobias.lindqvist@meridiantalent.com` | Top of funnel; cannot submit onward or see offers |
| Hiring Manager | `victor.castellanos@meridiantalent.com` | Their requirements; approves offers but cannot draft them |
| Interviewer | `kiran.pillai@meridiantalent.com` | Only their own panels and scorecards |
| Read-only Management | `helena.voss@meridiantalent.com` | Dashboards and analytics; no writes, no candidate contact details |

---

## Stack

- **Next.js 16** (App Router, React Server Components, Server Actions)
- **TypeScript** in strict mode
- **PostgreSQL 16** via **node-postgres**, with **Drizzle ORM** and generated migrations
- **Tailwind CSS v4** on a semantic design-token layer
- **Zod** for input validation, **Recharts** for charts, **dnd-kit** for the board
- **Postgres full-text search** for the search box, **`LISTEN`/`NOTIFY`** for live updates,
  and a Postgres table as the background job queue

No API keys and no cloud services — the only dependency is a Postgres container,
started by `npm run db:up`. The "AI" features are deterministic and run in-process;
see [Matching, parsing and the assistant](#matching-parsing-and-the-assistant).

---

## Architecture

```
src/
  db/
    schema.ts        26 tables, typed end to end
    index.ts         one cached pool per process
    seed.ts          simulation that generates the sample organisation
  lib/
    domain.ts        every stage, status and enum declared once, with label + colour
    validation.ts    Zod schemas shared by forms and actions
    match-score.ts   candidate-to-requirement scoring, explainable by construction
    jd-parse.ts      job descriptions -> fields, with confidence and evidence
    resume-parse.ts  resumes -> fields, likewise
    nl-query.ts      English -> a closed, structured query
  server/
    queries/         read models, all scoped by the actor
    actions/         "use server" mutations with validation + audit logging
    rules.ts         the business rules, as pure functions
    jobs/            a Postgres-backed work queue and its worker
    integrations/    calendar, email and job-board ports with no-op defaults
    realtime.ts      LISTEN/NOTIFY fan-out behind the SSE stream
    search.ts        full-text query building
    privacy.ts       subject access, erasure, retention
    __integration__/ tests that drive real actions through real sessions
  components/
    ui/              primitives (button, modal, table, toast, meter…)
    charts/          validated palette + chart components
    domain/          badges, board, filter bar, forms
  app/               routes
```

### Single source of truth for vocabulary

`src/lib/domain.ts` declares each stage, status, priority, source, interview type and
offer state exactly once, together with its human label and its colour tone. The database,
the validation schemas and every badge in the UI read from the same table, so they cannot
drift apart. Stage SLAs live there too, which is what drives the aging chips and the "past
the stage target" counts.

**Pipeline stages** are rows, not constants. They ship as the eleven from the
specification — New, Screening, Qualified, Submitted, Client Review, Interview Scheduled,
Interview Completed, Feedback Pending, Selected, Offer, Joined — plus Rejected, Withdrawn
and On Hold as terminal states, and an administrator can rename, reorder, retune or add to
them in Settings.

What makes that safe is that the application does not reason about stage *names*. Each
stage carries a **phase** — sourcing, submitted, interviewing, offer, placement — and every
rule in the codebase is written against the phase. Rename "Client Review" to "Panel Sift"
and the funnel, the interview sync and each requirement's derived status all keep working,
because none of them ever mentioned the name. The
three interview-band stages are not three things a recruiter has to remember to click:
they are recomputed from the actual interviews and scorecards whenever either changes, so
"Feedback Pending" always means somebody genuinely owes a scorecard.

**Requirement statuses** are the specification's ten, but only six of them are decisions.
Draft, Open, On hold, Filled, Cancelled and Closed are set by a person and stored on the
row; Active Sourcing, Candidate Submitted, Interviewing and Offer describe how far the
pipeline has got and are derived on read. Storing those four would create a second source
of truth that disagrees with the board the moment anyone moves a card, so the status menu
offers only the six and the requirement is *displayed* as whatever its pipeline says.

### Access control

Three rules keep this auditable rather than clever:

1. **Permissions live in the database**, seeded from `src/lib/permissions.ts`, because the
   specification requires the matrix to be configurable. Scope is encoded in the
   permission itself (`requisition.view.all` versus `requisition.view.assigned`), so every
   decision is one boolean lookup.
2. **Scope is a SQL predicate, not a filter.** A recruiter who cannot see a requirement
   never receives its row, so there is nothing to leak through a serialised prop, an API
   route or a future AI assistant.
3. **Mutations are guarded by a wrapper, not by convention.** Every action is exported as
   `guarded("permission", impl)`, so a new action cannot forget its check — there is no
   path to the handler that skips it. This matters because server actions are POST
   endpoints reachable by anyone who can load the page; a button hidden in the UI is not a
   control.

Candidate contact details and compensation are stripped server-side for roles without
`candidate.pii`, so they are absent from the HTML rather than hidden with CSS. Sessions
are opaque tokens in an `HttpOnly` cookie; the database stores only their SHA-256 hash,
so a dump of the sessions table cannot be replayed. Passwords use scrypt from
`node:crypto`, and the sign-in path spends the same time on a missing account as a wrong
password so it cannot be used to enumerate users.

### Data integrity

Three guarantees from the specification, implemented once in
`src/server/integrity.ts` rather than re-derived in each action:

- **Structured change history.** The audit trail records a sentence *and* a
  `changes` array of `{field, label, from, to}`. Because the diff is computed
  against the stored row, saving a form without editing anything is recorded as
  "saved with no changes" instead of claiming an update that never happened.
- **Soft delete.** Deleting stamps `deletedAt` and `deletedBy`; every read
  filters them out. The row and everything anchored to it — stage events,
  interviews, audit entries — survive, so a mistaken delete is recoverable and
  history is never orphaned.
- **Optimistic concurrency.** Each editable row carries a `rowVersion`. Forms
  submit the version they were rendered with, and the action compares before
  writing. A save built on a stale read is refused with a message telling the
  user to reload, rather than quietly overwriting a colleague's work.

Why Postgres: SQLite served the single-writer case well, but §1 requires several
recruiters to work at once and see each other's updates. SQLite takes one writer at a
time; Postgres does not. It has since earned its place three more times — `LISTEN`/`NOTIFY`
carries live updates between instances, `select … for update skip locked` is the job
queue, and a generated `tsvector` column with a GIN index is the search.

### Reads and writes

Pages are server components that call query functions in `src/server/queries`. Filtering,
sorting and pagination happen in SQL — the candidate list reads a page of forty rows, not
the whole table — and a per-request memo (`server/request-cache.ts`) means several sections
of the dashboard asking for the same list produce one query rather than four.

Mutations are server actions that validate with Zod, return `{ ok, message, errors }`,
write an activity row, revalidate the affected paths, and — because that activity row is
also the broadcast — tell every other open browser that something changed.

Business rules are enforced in the action layer, not the UI:

- Accepting an offer marks the submission hired, the candidate placed, and recounts the
  requisition's filled seats — closing the requisition when the last seat goes.
- Offer transitions are checked against a state machine (`OFFER_TRANSITIONS`); an illegal
  move is rejected with an explanation rather than silently applied.
- Re-opening the terms of an approved offer drops the approval, because it is no longer
  the offer that was approved.
- Adding a candidate straight into a later stage backfills the earlier stage events, so
  funnel analytics stay honest.
- Scheduling a loop advances a candidate to Interview Scheduled, but never drags anyone
  backwards: somebody already at Selected who picks up an extra round keeps their stage.
- On Hold is reversible and does not cost a candidate their place — reopening reads the
  stage they left back off the stage history rather than restarting them at Screening.
- A requirement's accepted work authorizations and a candidate's own are the same
  vocabulary, so the board can flag a candidate the client will not accept.
- Declining feedback only counts once every panelist has weighed in; the round outcome is
  then derived from the balance of recommendations rather than asked for twice.

### Matching, parsing and the assistant

These are the product's "AI" features, and none of them call a model. That is a decision,
not a shortcut, and it rests on four things:

- **Explainability.** §16 asks the matcher to show its reasoning. A scoring function that
  returns seven factors, each with its own verdict and the evidence behind it, is explicable
  by construction. A model that returns 87 can be asked to narrate afterwards, which is a
  different and weaker claim.
- **Regulation.** Automated tools used in hiring decisions attract NYC Local Law 144 and
  the EU AI Act. A deterministic, inspectable, auditable function is on the right side of
  both; a prompt is an argument with a regulator.
- **PII.** A resume is personal data. Parsing it in-process means it is never sent anywhere,
  which is also what makes the erasure guarantee in `server/privacy.ts` true.
- **Accuracy.** The fields being matched are already structured — skills, years, location,
  work authorization, rate. There is nothing here a language model would read better.

The assistant works the same way. A question becomes a **closed structured query** —
entity, filters, a bounded vocabulary — which is then executed by the same scoped query
functions the pages call. It cannot invent a filter, reach a table it was not given, or
return a row the asker could not have navigated to, because there is no free-form step
between the question and the SQL for an injected instruction to attach to.

`AiProvider` is a port with a local implementation, so a deployment that wants a model can
add one in a single file. It carries an `external: boolean` the UI reads, because "this
left the building" is something a recruiter handling someone's CV should be told.

### Charts

The palette is not eyeballed. The categorical series order and the single-hue ordinal ramp
were both run through a colour-vision validator against the real light and dark chart
surfaces — adjacent-pair CVD ΔE 9.1 light / 8.4 dark for the categorical order, and a
monotone blue ramp with ΔL ≥ 0.06 between steps for ordered categories such as funnel
stages and age bands. Values live in `src/components/charts/palette.ts`.

Two consequences worth knowing about:

- **No dual-axis charts anywhere.** Where series differ by an order of magnitude —
  pipeline additions against hires — the view uses small multiples with independent
  scales, because a shared axis flattens the series that matters and a second axis invents
  a correlation that is not in the data.
- **Every chart has a table view** behind the toggle in its corner, which is also the
  accessibility relief for the light-mode hues that sit below 3:1 against white.

Note that `var()` does not work in SVG *presentation attributes*, only in CSS
declarations. The chart components therefore resolve their tokens to real colours on the
client and re-resolve when the theme class changes.

---

## The sample data

`npm run db:seed` does not scatter random rows. It simulates the org running for about
eleven months: requisitions open, candidates enter pipelines, dwell in stages for plausible
lengths of time, get interviewed, collect scorecards, and either convert or drop out for a
recorded reason.

Live submissions are generated **backwards from today**, so stage ages, SLA breaches and
the upcoming interview schedule look like a real week; closed submissions are walked
forwards through history. That is what makes the derived metrics — time to fill, stage
velocity, source conversion, offer acceptance — agree with each other instead of being
independently random.

Eight requirements are reserved as this fortnight's intake and the rest carry real
history, so both ends of the desk are populated: fresh requirements still only sourcing,
and old ones with twelve months of funnel behind them. How far a candidate can have got is
capped by how long their requirement has been open — a role posted last week cannot have
somebody at offer.

Roughly: 30 people, 12 client accounts, 54 requisitions, ~1,300 candidates, ~1,300
submissions, ~5,000 stage events, ~700 interviews, ~700 scorecards, ~60 offers, ~1,170
logged calls and emails, and ~5,900 activity entries — of which ~1,700 carry a structured
field-level diff. About 230 candidates are live across the working stages.

Some of it is deliberately imperfect, because several features have nothing to demonstrate
against clean data: seven near-duplicate candidate records for the merge flow, seventeen
candidates who have gone quiet, and five requirements already at risk of their SLA.

The generator is seeded, so the same database comes out every time. Re-running it drops and
recreates the tables **in place** rather than deleting the file, so it works while the dev
server is running (on Windows the server holds an open handle).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest — 261 unit tests, no database needed |
| `npm run test:integration` | 25 tests against real Postgres, real sessions, real actions |
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:generate` | Generate a migration from `schema.ts` |
| `npm run db:seed` | Rebuild the database from the simulation |
| `npm run db:reset` | Generate then seed |
| `npm run db:studio` | Drizzle Studio against the local database |

The connection defaults to `postgres://rcc:rcc_local_dev@localhost:5433/rcc`;
override with `DATABASE_URL`.

---

## Notes and limitations

Honest gaps, not a roadmap. `BACKLOG.md` tracks all 45 items and what was done for each.

- **Authentication is password-only.** No SSO, no MFA, no password-reset flow.
  `src/server/auth.ts` and `src/server/session.ts` are the two files an identity provider
  would replace; nothing else reads the cookie.
- **Single tenant.** Every row belongs to one organisation. Multi-tenancy is the one
  backlog item deliberately left undone — it is an XL change to every query in the system
  and only worth making if multi-company is genuinely in scope.
- **No external integrations are configured.** Calendar, email and job boards exist as
  ports with no-op defaults that decline honestly rather than pretending to send. Adding a
  provider is one file; until then Settings says plainly that nothing is connected.
- **Encryption at rest is a deployment control**, not an application one, and deliberately
  so: encrypting these columns in the app would put the key beside the data and break every
  search that makes the product work. It belongs to the volume or the managed instance.
- **The job worker runs in-process**, started from `instrumentation.ts`. That is the right
  shape for one Node process serving the app; a separate worker process is a better answer
  at a scale this is not at, and moving to one changes `server/jobs/worker.ts` and nothing
  else. `JOB_WORKER=off` disables it per instance.
- **Soft delete has no UI.** The columns, predicates and helpers exist and every read
  honours them, but no screen offers "delete" or "restore". Erasure — which is a different
  operation, and irreversible — does have one, on the candidate record.
- **Search stops matching mid-word.** `like '%gine%'` used to find "Engineer"; full-text
  does not. In exchange it is stemmed, prefix-matched on the word being typed, ranked, and
  roughly 3.5× faster at 200,000 rows.
