-- Bring an existing database's permission matrix in line with
-- `src/lib/permissions.ts` without re-seeding.
--
-- The matrix lives in the database so it stays configurable at runtime, which
-- means adding a permission in code does not add it to a deployment that is
-- already carrying real data. This script is the other half of that: it is
-- idempotent, it never removes a grant an administrator has made by hand, and
-- it only adds what the code now defines.
--
-- Run: docker exec -i rcc-postgres psql -U rcc -d rcc -f /dev/stdin < scripts/sync-permissions.sql

insert into permissions (key, label, category, description, sensitive)
values (
  'privacy.manage',
  'Handle data-subject requests',
  'Governance',
  'Export everything held about a person, and erase it on request. Separate from deleting a record.',
  true
)
on conflict (key) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description,
      sensitive = excluded.sensitive;

-- Super Admin only, deliberately: erasure is irreversible and answers a legal
-- request rather than a recruiting need. Another role can be granted it in
-- the settings screen, which is the point of these being rows.
insert into role_permissions (id, role_key, permission_key)
select 'rpm_privacy1', 'super_admin', 'privacy.manage'
where not exists (
  select 1 from role_permissions
  where role_key = 'super_admin' and permission_key = 'privacy.manage'
);
