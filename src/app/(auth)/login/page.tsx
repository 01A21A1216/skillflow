import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { ROLES } from "@/lib/permissions";
import { LoginForm } from "@/components/auth/login-form";
import { currentUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The demo account list is a development convenience only. It is compiled out
 * in production builds so a deployed instance never advertises credentials.
 */
function demoAccounts() {
  if (process.env.NODE_ENV === "production") return [];
  return ROLES.map((role) => {
    const person = db
      .select({ name: users.name, email: users.email, title: users.title })
      .from(users)
      .where(eq(users.role, role.key))
      .get();
    return person ? { role: role.label, ...person } : null;
  }).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  const anyUsers = db.select({ id: users.id }).from(users).limit(1).all().length > 0;
  const seeded =
    anyUsers &&
    db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.role, ROLES.map((r) => r.key)))
      .limit(1)
      .all().length > 0;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-7 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-contrast">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 19V7l5 4 3-6 3 6 5-4v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h1 className="text-[17px] leading-tight font-semibold text-content">
            Recruitment Command Center
          </h1>
          <p className="text-[12.5px] text-content-subtle">Meridian Talent</p>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-[15px] font-semibold text-content">Sign in</h2>
        <p className="mt-1 mb-5 text-[13px] text-content-muted">
          Use your work account. Sessions last 12 hours.
        </p>
        <LoginForm />
      </div>

      {!seeded ? (
        <p className="mt-4 rounded-lg bg-[hsl(var(--tone-amber-bg))] px-3 py-2.5 text-[12.5px] text-[hsl(var(--tone-amber))]">
          No accounts found. Run <code className="font-mono">npm run db:reset</code> to create the
          schema and load the sample organisation.
        </p>
      ) : null}

      <DemoAccounts />
    </div>
  );
}

function DemoAccounts() {
  const accounts = demoAccounts();
  if (!accounts.length) return null;

  return (
    <details className="mt-4 rounded-lg border border-border-base bg-surface-muted/50 px-3.5 py-3">
      <summary className="cursor-pointer text-[12.5px] font-medium text-content-muted select-none">
        Demo accounts — one per role
      </summary>
      <p className="mt-2 text-[11.5px] leading-relaxed text-content-subtle">
        Development only. Every demo account uses the password{" "}
        <code className="rounded bg-surface px-1 py-0.5 font-mono">demo1234</code>. Sign in as
        different roles to see permissions change what the app shows.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {accounts.map((a) => (
          <li key={a.email} className="flex items-baseline justify-between gap-3 text-[11.5px]">
            <span className="truncate text-content-muted">{a.role}</span>
            <code className="shrink-0 font-mono text-content-subtle">{a.email}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
