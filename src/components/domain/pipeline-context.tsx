"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_STAGES, Pipeline, type StageDef } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";

/**
 * The configured stages, for client components.
 *
 * Stages are rows now (§8), so a board column list or a "move to" picker cannot
 * come from a compile-time constant. The layout loads them once per request and
 * publishes them here; everything below reconstructs the same `Pipeline` helper
 * the server uses, so both sides answer stage questions identically.
 *
 * `StageDef[]` crosses the boundary rather than the `Pipeline` instance itself,
 * because a class does not survive serialisation.
 */
const PipelineContext = createContext<StageDef[] | null>(null);

export function PipelineProvider({
  stages,
  children,
}: {
  stages: StageDef[];
  children: ReactNode;
}) {
  return <PipelineContext.Provider value={stages}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): Pipeline {
  const stages = useContext(PipelineContext);
  // Rebuilding on every render would be wasteful on a board of 200 cards.
  return useMemo(() => new Pipeline(stages ?? DEFAULT_STAGES), [stages]);
}

/**
 * A stage badge.
 *
 * A client component even though most of its callers are server components,
 * because a stage's label and colour are now configuration rather than
 * constants — it has to read them from the provider the layout publishes. The
 * boundary is cheap: it renders one span.
 */
export function StageBadge({
  value,
  dot,
  size,
  variant,
  className,
}: {
  value: string;
  dot?: boolean;
  size?: "sm" | "md";
  variant?: "soft" | "outline" | "solid";
  className?: string;
}) {
  const pipeline = usePipeline();
  const stage = pipeline.get(value);
  return (
    <Badge tone={stage.tone} dot={dot} size={size} variant={variant} className={className}>
      {stage.label}
    </Badge>
  );
}
