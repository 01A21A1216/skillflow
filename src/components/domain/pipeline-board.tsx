"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CalendarClock, GripVertical, ShieldAlert, Star } from "lucide-react";

import type { PipelineCard } from "@/server/queries/pipeline";
import { moveStageById } from "@/server/actions/pipeline";
import { WORK_AUTHORIZATION, type Stage, type WorkAuthorization } from "@/lib/domain";
import { usePipeline } from "./pipeline-context";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { toneVars } from "@/components/ui/tone";
import { AgeChip, SkillChips } from "./badges";
import { CardActions, usePipelineOptions } from "./pipeline-actions";

/**
 * Arrow keys move a dragged card a whole column at a time.
 *
 * dnd-kit's default keyboard getter steps 25 pixels per press, which on a
 * board of 312-pixel columns means thirteen presses to move one stage.
 * `sortableKeyboardCoordinates` is no better here — it is built for sortable
 * lists, and this board is plain droppables. So: left and right jump to the
 * next column's centre, up and down scroll within one.
 */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  const columns = [...context.droppableContainers.values()]
    .filter((c) => c.rect.current)
    .map((c) => ({ id: c.id, rect: c.rect.current! }))
    .sort((a, b) => a.rect.left - b.rect.left);

  if (!columns.length) return undefined;

  const here = columns.findIndex(
    (c) => currentCoordinates.x >= c.rect.left && currentCoordinates.x <= c.rect.left + c.rect.width,
  );

  switch (event.code) {
    case "ArrowRight": {
      const next = columns[Math.min(here + 1, columns.length - 1)];
      return next ? { ...currentCoordinates, x: next.rect.left + next.rect.width / 2 } : undefined;
    }
    case "ArrowLeft": {
      const prev = columns[Math.max(here - 1, 0)];
      return prev ? { ...currentCoordinates, x: prev.rect.left + prev.rect.width / 2 } : undefined;
    }
    case "ArrowDown":
      return { ...currentCoordinates, y: currentCoordinates.y + 80 };
    case "ArrowUp":
      return { ...currentCoordinates, y: currentCoordinates.y - 80 };
    default:
      return undefined;
  }
};

/** Cards rendered per column before the rest are behind a control. */
const COLUMN_CAP = 40;

interface Move {
  id: string;
  stage: Stage;
}

export function PipelineBoard({
  cards,
  requiredSkills,
  compact = false,
  columns: columnKeys,
}: {
  cards: PipelineCard[];
  /** Highlighted on cards when viewing a single requisition. */
  requiredSkills?: string[];
  compact?: boolean;
  /**
   * Which columns to render. Defaults to the live board; a drill-down from a
   * KPI passes the one stage, or the terminal stage, it is actually about —
   * nine empty columns beside one full one is not a useful answer.
   */
  columns?: Stage[];
}) {
  const toast = useToast();
  const pipeline = usePipeline();
  const { capabilities } = usePipelineOptions();
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<PipelineCard | null>(null);

  // The board repaints immediately on drop; the server action reconciles after.
  const [optimistic, applyMove] = useOptimistic(cards, (state: PipelineCard[], move: Move) =>
    state.map((c) =>
      c.id === move.id ? { ...c, stage: move.stage, daysInStage: 0, isAging: false } : c,
    ),
  );

  // Pointer *and* keyboard. A board that can only be operated by dragging
  // excludes anyone who does not use a mouse, and moving a candidate forward
  // is the single most common action in the application.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  );

  /**
   * What a screen reader hears while dragging.
   *
   * dnd-kit's defaults describe positions ("moved to position 3"), which on a
   * kanban board is meaningless — the useful fact is which column you are
   * over and whose card you are holding.
   */
  const announcements = useMemo(
    () => ({
      onDragStart({ active }: { active: { id: string | number } }) {
        const card = optimistic.find((c) => c.id === active.id);
        return card
          ? `Picked up ${card.candidateName}, currently in ${pipeline.label(card.stage)}. Use the arrow keys to choose a column, space to drop, escape to cancel.`
          : "Picked up a candidate.";
      },
      onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        const card = optimistic.find((c) => c.id === active.id);
        if (!over || !card) return undefined;
        return `${card.candidateName} is over ${pipeline.label(String(over.id))}.`;
      },
      onDragEnd({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        const card = optimistic.find((c) => c.id === active.id);
        if (!card) return undefined;
        return over
          ? `${card.candidateName} moved to ${pipeline.label(String(over.id))}.`
          : `${card.candidateName} was not moved.`;
      },
      onDragCancel({ active }: { active: { id: string | number } }) {
        const card = optimistic.find((c) => c.id === active.id);
        return card ? `Move cancelled. ${card.candidateName} stayed where they were.` : undefined;
      },
    }),
    [optimistic, pipeline],
  );

  const shown = useMemo(
    () => columnKeys ?? pipeline.active,
    [columnKeys, pipeline],
  );

  const columns = useMemo(() => {
    const map = new Map<Stage, PipelineCard[]>();
    for (const stage of shown) map.set(stage, []);
    for (const card of optimistic) map.get(card.stage)?.push(card);
    for (const list of map.values()) {
      list.sort((a, b) => b.daysInStage - a.daysInStage || b.matchScore - a.matchScore);
    }
    return map;
  }, [optimistic, shown]);

  function onDragStart(event: DragStartEvent) {
    setDragging(optimistic.find((c) => c.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const target = event.over?.id as Stage | undefined;
    const card = optimistic.find((c) => c.id === event.active.id);
    if (!target || !card || card.stage === target) return;

    startTransition(async () => {
      applyMove({ id: card.id, stage: target });
      const result = await moveStageById(card.id, target);
      toast(
        result.ok
          ? {
              kind: "success",
              title: `${card.candidateName} → ${pipeline.label(target)}`,
              description: card.requisitionTitle,
            }
          : { kind: "error", title: "Could not move candidate", description: result.message },
      );
    });
  }

  return (
    <DndContext
      id="pipeline-board"
      sensors={sensors}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {shown.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            cards={columns.get(stage) ?? []}
            requiredSkills={requiredSkills}
            compact={compact}
            draggable={capabilities.move}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="w-[19rem] rotate-1 opacity-95">
            <Card card={dragging} requiredSkills={requiredSkills} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  cards,
  requiredSkills,
  compact,
  draggable,
}: {
  stage: Stage;
  cards: PipelineCard[];
  requiredSkills?: string[];
  compact: boolean;
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = usePipeline().get(stage);
  const aging = cards.filter((c) => c.isAging).length;

  /**
   * Cards are capped rather than virtualised.
   *
   * Virtualisation and drag-and-drop are in tension: dnd-kit needs its drop
   * targets mounted to measure them, so a windowed list breaks dragging onto
   * anything scrolled out of view. A cap bounds the DOM — which was the
   * actual concern — without that conflict, and the cards beyond it are the
   * freshest ones in a column already sorted oldest-first.
   */
  const [expanded, setExpanded] = useState(false);
  const shownCards = expanded ? cards : cards.slice(0, COLUMN_CAP);
  const hidden = cards.length - shownCards.length;

  return (
    <section
      ref={setNodeRef}
      style={toneVars(meta.tone)}
      className={cn(
        "flex w-[19.5rem] shrink-0 flex-col rounded-xl border transition-colors",
        isOver
          ? "border-[hsl(var(--tone))] bg-[hsl(var(--tone-bg))]"
          : "border-border-base bg-surface-muted/55",
      )}
      aria-label={`${meta.label} column`}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="size-2 shrink-0 rounded-full bg-[hsl(var(--tone))]" aria-hidden />
        <h3 className="text-[13px] font-semibold text-content">{meta.label}</h3>
        <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] text-content-muted tabular-nums">
          {cards.length}
        </span>
        {aging > 0 ? (
          <span
            className="ml-auto text-[11px] text-[hsl(var(--tone-amber))] tabular-nums"
            title={`${aging} past the stage target`}
          >
            {aging} aging
          </span>
        ) : null}
      </header>

      <div className="flex min-h-[6rem] flex-1 flex-col gap-2 px-2 pb-2">
        {cards.length ? (
          shownCards.map((card) => (
            draggable ? (
              <DraggableCard
                key={card.id}
                card={card}
                requiredSkills={requiredSkills}
                compact={compact}
              />
            ) : (
              <Card key={card.id} card={card} requiredSkills={requiredSkills} compact={compact} />
            )
          ))
        ) : (
          <p className="px-2 py-6 text-center text-[12px] text-content-subtle">
            {draggable ? "Drop a candidate here" : "Nobody at this stage"}
          </p>
        )}

        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-lg border border-dashed border-border-strong px-2 py-2 text-[12px] text-content-muted transition-colors hover:bg-surface hover:text-content"
          >
            Show {hidden} more
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  requiredSkills,
  compact,
}: {
  card: PipelineCard;
  requiredSkills?: string[];
  compact: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  const pipeline = usePipeline();

  return (
    // `attributes` already supplies role, tabIndex and the keyboard
    // instructions dnd-kit needs; the label is overridden because the default
    // says "draggable item" and a recruiter needs to know *whose* card has
    // focus before they start moving it.
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`${card.candidateName}, ${pipeline.label(card.stage)} on ${card.requisitionCode}`}
      className={cn(
        "cursor-grab touch-none select-none rounded-lg outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--surface-muted))]",
        "active:cursor-grabbing",
        isDragging && "opacity-35",
      )}
    >
      <Card card={card} requiredSkills={requiredSkills} compact={compact} draggable />
    </div>
  );
}

function Card({
  card,
  requiredSkills,
  compact = false,
  overlay = false,
  draggable = false,
}: {
  card: PipelineCard;
  requiredSkills?: string[];
  compact?: boolean;
  overlay?: boolean;
  draggable?: boolean;
}) {
  return (
    <article
      className={cn(
        "group rounded-lg border border-border-base bg-surface p-2.5 shadow-[var(--shadow-card)] transition-shadow",
        overlay ? "shadow-[var(--shadow-pop)]" : "hover:shadow-[var(--shadow-raised)]",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable || overlay ? (
          <span
            className="mt-0.5 shrink-0 text-content-subtle opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          >
            <GripVertical className="size-3.5" />
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/candidates/${card.candidateId}`}
              className="min-w-0 text-[13px] leading-tight font-medium text-content hover:text-brand"
            >
              {card.candidateName}
            </Link>
            <AgeChip days={card.daysInStage} sla={card.slaDays} />
          </div>

          <p className="mt-0.5 truncate text-[11.5px] text-content-muted">{card.candidateTitle}</p>

          {!compact ? (
            <Link
              href={`/requisitions/${card.requisitionId}`}
              className="mt-1.5 block truncate text-[11.5px] text-content-subtle hover:text-brand"
            >
              {card.requisitionCode} · {card.requisitionTitle}
            </Link>
          ) : null}

          <div className="mt-2">
            <SkillChips skills={card.candidateSkills} max={3} matched={requiredSkills} />
          </div>

          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-content-subtle">
            <span>{WORK_AUTHORIZATION[card.candidateWorkAuthorization as WorkAuthorization]?.label ?? card.candidateWorkAuthorization}</span>
            {card.visaMismatch ? (
              <span
                className="flex items-center gap-1 text-[hsl(var(--tone-rose))]"
                title="This client does not accept that work authorization"
              >
                <ShieldAlert className="size-3 shrink-0" />
                not accepted
              </span>
            ) : null}
          </p>

          {card.nextInterviewAt ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[hsl(var(--tone-violet))]">
              <CalendarClock className="size-3 shrink-0" />
              {formatDate(card.nextInterviewAt, false)} at {formatTime(card.nextInterviewAt)}
            </p>
          ) : null}

          <footer className="mt-2.5 flex items-center gap-2 border-t border-border-base pt-2">
            <Avatar name={card.ownerName} size="xs" />
            <span
              className="flex items-center gap-1 text-[11px] text-content-subtle tabular-nums"
              title="Match score against the requisition"
            >
              <Star className="size-3" />
              {card.matchScore}
            </span>
            {!overlay ? <CardActions card={card} /> : null}
          </footer>
        </div>
      </div>
    </article>
  );
}
