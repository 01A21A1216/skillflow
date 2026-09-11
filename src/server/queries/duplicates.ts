import "server-only";

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates } from "@/db/schema";
import {
  findDuplicates,
  normaliseName,
  normalisePhone,
  type DuplicateMatch,
  type Identity,
} from "@/lib/matching";

export interface DuplicateCandidate {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  currentCompany: string;
  location: string;
  status: string;
  createdAt: Date;
  match: DuplicateMatch;
}

/**
 * Possible duplicates of a candidate (§6).
 *
 * The pool is narrowed in SQL first — same email, same phone digits, or the
 * same surname — so this stays a handful of rows rather than the whole table
 * at a hundred thousand candidates. The scoring then runs in TypeScript, where
 * it is testable and explainable.
 */
export async function potentialDuplicates(subject: Identity & { id?: string }) {
  const phone = normalisePhone(subject.phone);
  const surname = normaliseName(subject.lastName);
  if (!subject.email && !phone && !surname) return [];

  const clauses = [];
  if (subject.email) clauses.push(eq(sql`lower(${candidates.email})`, subject.email.toLowerCase()));
  if (phone) {
    // Compare the last ten digits, which is the same normalisation the scorer
    // uses. Without it, formatting differences hide every phone match.
    clauses.push(eq(sql`right(regexp_replace(coalesce(${candidates.phone}, ''), '\D', '', 'g'), 10)`, phone));
  }
  if (surname.length >= 3) {
    clauses.push(
      eq(sql`lower(regexp_replace(${candidates.lastName}, '[^a-zA-Z0-9]', '', 'g'))`, surname),
    );
  }

  const match = or(...clauses);
  if (!match) return [];

  const rows = await db
    .select()
    .from(candidates)
    .where(
      and(
        isNull(candidates.deletedAt),
        subject.id ? ne(candidates.id, subject.id) : undefined,
        match,
      ),
    )
    .limit(40);

  const pool: (Identity & { row: (typeof rows)[number] })[] = rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    currentCompany: r.currentCompany,
    location: r.location,
    linkedinUrl: r.linkedinUrl,
    row: r,
  }));

  const byId = new Map(pool.map((p) => [p.id!, p.row]));

  return findDuplicates(subject, pool)
    .map(({ other, match: m }) => {
      const row = byId.get(other.id!);
      if (!row) return null;
      return {
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        email: row.email,
        phone: row.phone,
        currentCompany: row.currentCompany,
        location: row.location,
        status: row.status,
        createdAt: row.createdAt,
        match: m,
      } satisfies DuplicateCandidate;
    })
    .filter((r): r is DuplicateCandidate => r !== null);
}
