import { NextResponse } from "next/server";

import { listCandidates } from "@/server/queries/candidates";
import { listRequisitions } from "@/server/queries/requisitions";
import { listUsers } from "@/server/queries/people";
import { loadPipeline } from "@/server/pipeline";

export const dynamic = "force-dynamic";

export interface SearchHit {
  id: string;
  kind: "requisition" | "candidate" | "person";
  title: string;
  subtitle: string;
  meta?: string;
  href: string;
}

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return NextResponse.json({ hits: [] });

  const pipeline = await loadPipeline();

  const hits: SearchHit[] = [];

  for (const r of (await listRequisitions({ q: term })).slice(0, 6)) {
    hits.push({
      id: r.id,
      kind: "requisition",
      title: r.title,
      subtitle: `${r.code} · ${r.clientName} · ${r.location}`,
      meta: `${r.activeCount} active`,
      href: `/requisitions/${r.id}`,
    });
  }

  for (const c of (await listCandidates({ q: term, sort: "rating", limit: 6 })).rows) {
    hits.push({
      id: c.id,
      kind: "candidate",
      title: `${c.firstName} ${c.lastName}`,
      subtitle: `${c.currentTitle} at ${c.currentCompany}`,
      meta: c.furthestStage ? pipeline.label(c.furthestStage) : undefined,
      href: `/candidates/${c.id}`,
    });
  }

  const lower = term.toLowerCase();
  for (const u of (await listUsers())
    .filter((u) => u.name.toLowerCase().includes(lower) || u.title.toLowerCase().includes(lower))
    .slice(0, 3)) {
    hits.push({
      id: u.id,
      kind: "person",
      title: u.name,
      subtitle: u.title,
      href: `/team/${u.id}`,
    });
  }

  return NextResponse.json({ hits });
}
