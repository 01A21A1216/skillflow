import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lightbulb, MessageCircleQuestion, ShieldCheck } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { answer, assistantVocabulary } from "@/server/queries/assistant";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assistant" };

/** The questions §15 gives as examples, offered as a starting point. */
const EXAMPLES = [
  "Show all Oracle DBA candidates available immediately",
  "Which requirements have been open for more than 15 days?",
  "Show candidates waiting for client feedback",
  "Which recruiters have the highest interview-to-selection ratio?",
  "Find candidates with Oracle EBS R12 and PL/SQL",
  "Which requirements have no candidate submissions?",
  "Candidates with 10+ years Oracle Fusion Cloud",
  "Show interviews this week",
];

/**
 * The assistant (§15).
 *
 * A plain form rather than a chat, and that is a considered choice: a question
 * here maps to a filtered view of records the asker can already reach, so the
 * useful reply is the records themselves plus a statement of how the question
 * was read. A conversational wrapper would add turns without adding answers.
 *
 * It has no privileged access. Every question is executed through the same
 * scoped query functions the pages use, which is what makes §15's "never
 * expose information the user is not authorized to see" a structural property
 * rather than a promise.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const question = (raw ?? "").trim();

  const actor = await requireUser();
  const vocabulary = await assistantVocabulary();
  const result = question ? await answer(question, actor, vocabulary) : null;

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about your requirements, candidates, interviews and desks in plain language."
      />

      <PageBody>
        <Card>
          <form action="/assistant" className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MessageCircleQuestion className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-content-subtle" />
              <input
                name="q"
                defaultValue={question}
                autoFocus
                placeholder="Which requirements have been open for more than 15 days?"
                className="h-10 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-[13.5px] text-content placeholder:text-content-subtle focus:border-brand focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-brand-contrast hover:opacity-90"
            >
              Ask
              <ArrowRight className="size-4" />
            </button>
          </form>

          <p className="mt-3 flex items-start gap-1.5 border-t border-border-base pt-3 text-[11.5px] leading-relaxed text-content-subtle">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Answers are read through the same permission checks as every other screen, so this
              cannot show you anything you could not already open. Nothing you type leaves this
              system.
            </span>
          </p>
        </Card>

        {result ? (
          <Card padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
              <CardHeader
                title={result.headline}
                description={
                  result.interpretation.length
                    ? `Read as: ${result.interpretation.join(" · ")}`
                    : "Read as a plain text search."
                }
              />
              {result.fallback ? (
                <Badge tone="amber" size="sm">
                  not fully understood
                </Badge>
              ) : null}
            </div>

            {result.rows.length ? (
              <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                {result.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={row.href}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-content">
                          {row.title}
                        </span>
                        <span className="block text-[12px] text-content-muted">
                          {row.subtitle}
                        </span>
                      </span>
                      {row.meta ? (
                        <span className="shrink-0 text-[11.5px] text-content-subtle tabular-nums">
                          {row.meta}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-border-base px-5 py-6 text-[12.5px] text-content-subtle">
                Nothing matched. Try naming a skill, a requirement code, or a number of days.
              </p>
            )}

            {result.seeAllHref && result.total > result.rows.length ? (
              <Link
                href={result.seeAllHref}
                className="block border-t border-border-base px-5 py-3 text-[12.5px] text-brand hover:underline"
              >
                See all {result.total} with the usual filters →
              </Link>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardHeader
            icon={<Lightbulb className="size-4" />}
            title="Things it understands"
            description="Skills, locations, availability, experience, requirement codes, ages and a few named situations."
          />
          <ul className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <Link
                  href={`/assistant?q=${encodeURIComponent(e)}`}
                  className="inline-block rounded-lg border border-border-base px-2.5 py-1.5 text-[12.5px] text-content-muted transition-colors hover:border-border-strong hover:text-content"
                >
                  {e}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-border-base pt-3 text-[11.5px] leading-relaxed text-content-subtle">
            A question is turned into a structured filter drawn from a fixed set of fields, then
            run through the ordinary query layer. It never becomes a database query of its own,
            which is why text inside a resume or a note cannot instruct it to do anything.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
