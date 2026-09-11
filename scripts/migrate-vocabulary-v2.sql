-- Phase 1 vocabulary migration: six pipeline stages to eleven, six requirement
-- statuses to ten, split skills, work-authorization codes (§5, §6, §8).
--
-- Run this ONCE against a database seeded before the change. A database created
-- by `npm run db:reset` after the change is already in the new shape and does
-- not need it. Every statement is idempotent, so a second run is a no-op.
--
--   psql "$DATABASE_URL" -f scripts/migrate-vocabulary-v2.sql

begin;

-- 1. Stage vocabulary. `interview` splits into three stages, and the split is
--    decided by what actually happened: a booked future round, an outstanding
--    scorecard, or neither.
update submissions set stage = 'new'    where stage = 'sourced';
update submissions set stage = 'joined' where stage = 'hired';

update submissions s set stage = case
  when exists (
    select 1 from interviews i
    where i.submission_id = s.id and i.status = 'scheduled' and i.scheduled_at > now()
  ) then 'interview_scheduled'
  when exists (
    select 1 from interviews i
    where i.submission_id = s.id and i.status = 'completed'
      and (select count(*) from feedback f where f.interview_id = i.id)
        < (select count(*) from interview_panel p where p.interview_id = i.id)
  ) then 'feedback_pending'
  else 'interview_completed'
end
where s.stage = 'interview';

-- History gets the entry stage: one event per stage entered, so the funnel does
-- not gain a step that never happened.
update stage_events set to_stage   = 'new'                 where to_stage   = 'sourced';
update stage_events set from_stage = 'new'                 where from_stage = 'sourced';
update stage_events set to_stage   = 'joined'              where to_stage   = 'hired';
update stage_events set from_stage = 'joined'              where from_stage = 'hired';
update stage_events set to_stage   = 'interview_scheduled' where to_stage   = 'interview';
update stage_events set from_stage = 'interview_scheduled' where from_stage = 'interview';

-- 2. Requirement statuses. The four new ones are derived on read, so nothing is
--    written here; only the authored six are ever stored and they are unchanged.

-- 3. Skills split. Everything previously captured was a must-have.
alter table requisitions add column if not exists required_skills   jsonb not null default '[]'::jsonb;
alter table requisitions add column if not exists preferred_skills  jsonb not null default '[]'::jsonb;
alter table requisitions add column if not exists visa_requirements jsonb not null default '[]'::jsonb;

update requisitions set required_skills = skills
where skills is not null and required_skills = '[]'::jsonb;

alter table requisitions drop column if exists skills;

-- 4. Work authorization codes.
update candidates set work_authorization = 'green_card' where work_authorization = 'permanent_resident';
update candidates set work_authorization = 'h1b'        where work_authorization = 'visa_holder';

commit;
