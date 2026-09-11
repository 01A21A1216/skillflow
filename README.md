# Recruitment Command Center

A centralised applicant tracking and recruiting-operations platform: open requirements,
recruiters, candidates, submissions, interviews, feedback, offers and hiring analytics in
one system.

It is built as an internal tool for a talent team that actually runs a desk — the home
screen answers "what needs me today?", not "here are some numbers" — and it ships with a
simulated recruiting organisation so every screen has real, self-consistent data behind it.

```bash
npm install
npm run db:reset   # create the schema and load the sample organisation
npm run dev        # http://localhost:3000
```

---

## What is in it

| Area | What it does |
|---|---|
| **Dashboard** | Eight operational KPIs, a ranked action queue (overdue scorecards, expiring offers, stalled candidates, at-risk requisitions), the 180-day conversion funnel, throughput small multiples, live pipeline composition, requisitions needing attention, and a team activity feed. |
| **Requisitions** | Filterable register with a derived **health** verdict per requisition, inline pipeline composition, openings filled, target-date tracking. Full detail view with an embedded drag-and-drop board, interviews, offers, close-out reasons, the brief, the working team and stage SLAs. |
| **Pipeline** | Global kanban across every requisition. Drag a candidate between stages and the move is written to their timeline, with optimistic repaint and a toast. Per-card actions for advancing, scheduling a loop, drafting an offer or closing out. |
| **Candidates** | Searchable talent pool with skill, seniority, source, ownership, work-authorisation and pipeline-state facets. Profiles show every requisition they have touched, the full interview history with scorecards, offers, an averaged competency chart and notes. |
| **Interviews** | Schedule grouped by day, panel composition with per-panelist feedback status, an "awaiting feedback" queue, and scorecard submission. Once every panelist has submitted, the round outcome settles automatically from the balance of recommendations. |
| **Offers** | Offer register with a legal-transition state machine, position against the approved salary band, total compensation, expiry tracking, decline-reason capture and acceptance-rate trend. |
| **Analytics** | Funnel with per-step conversion, stage velocity, time-to-fill and time-to-hire, 12-month throughput, source effectiveness, recruiter performance, pipeline aging, close-out reasons, interview operations and interviewer load. |
| **Team / Clients** | Recruiter capacity and utilisation, interviewer load and feedback debt; client accounts with demand, coverage and fill rate. |

Cross-cutting: ⌘K global search, URL-driven filters (every view is shareable and
survives a reload), light/dark themes, and an actor switcher so writes are attributed to a
real person and the audit trail stays meaningful.

---

## Stack

- **Next.js 16** (App Router, React Server Components, Server Actions)
- **TypeScript** in strict mode
- **SQLite** via **better-sqlite3**, with **Drizzle ORM** and generated migrations
- **Tailwind CSS v4** on a semantic design-token layer
- **Zod** for input validation, **Recharts** for charts, **dnd-kit** for the board

No external services, no API keys, no container. `npm install && npm run db:reset` is the
whole setup.

---

## Architecture

```
src/
  db/
    schema.ts        13 tables, typed end to end
    index.ts         one cached connection per process; runs migrations on boot
    seed.ts          simulation that generates the sample organisation
  lib/
    domain.ts        every stage, status and enum declared once, with label + colour
    validation.ts    Zod schemas shared by forms and actions
  server/
    queries/         read models (server-only, synchronous)
    actions/         "use server" mutations with validation + audit logging
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

### Reads and writes

Pages are server components that call synchronous query functions — better-sqlite3 is
synchronous, and the dataset is small enough that a handful of indexed aggregates beats any
caching layer. Mutations are server actions that validate with Zod, return
`{ ok, message, errors }`, write an activity row, and revalidate the affected paths.

Business rules are enforced in the action layer, not the UI:

- Accepting an offer marks the submission hired, the candidate placed, and recounts the
  requisition's filled seats — closing the requisition when the last seat goes.
- Offer transitions are checked against a state machine (`OFFER_TRANSITIONS`); an illegal
  move is rejected with an explanation rather than silently applied.
- Re-opening the terms of an approved offer drops the approval, because it is no longer
  the offer that was approved.
- Adding a candidate straight into a later stage backfills the earlier stage events, so
  funnel analytics stay honest.
- Scheduling a loop for someone still in screening advances them to the interview stage.
- Declining feedback only counts once every panelist has weighed in; the round outcome is
  then derived from the balance of recommendations rather than asked for twice.

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

Roughly: 29 people, 12 client accounts, 55 requisitions, ~1,300 candidates and submissions,
~4,400 stage events, ~830 interviews, ~790 scorecards, ~130 offers and ~6,200 activity
entries.

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
| `npm run db:generate` | Generate a migration from `schema.ts` |
| `npm run db:seed` | Rebuild the database from the simulation |
| `npm run db:reset` | Generate then seed |
| `npm run db:studio` | Drizzle Studio against the local database |

The database lives at `data/rcc.db`; override with `DATABASE_PATH`.

---

## Notes and limitations

- **There is no authentication.** The app operates "as" a chosen member of the talent team,
  picked from the top bar and remembered in a cookie, so every write is still attributed
  and the audit trail is meaningful. A real deployment would put an identity provider in
  front and derive the actor from the session instead — `src/server/session.ts` is the
  single place that would change.
- **Authorization is not modelled.** Every actor can perform every action. Role-based
  permissions (only leadership approves offers, hiring managers cannot edit bands) would
  belong in the action layer next to the existing business rules.
- **SQLite suits a single-node deployment.** The query layer is plain Drizzle, so moving to
  Postgres is a dialect change plus a connection swap, not a rewrite.
- Email, calendar and job-board integrations are out of scope; interviews record a meeting
  link rather than creating a real calendar event.
