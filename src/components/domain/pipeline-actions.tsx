"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  ExternalLink,
  FileSignature,
  MoreHorizontal,
  PauseCircle,
  RotateCcw,
  UserMinus,
} from "lucide-react";

import type { PipelineCard } from "@/server/queries/pipeline";
import { REJECTION_REASONS, type Stage } from "@/lib/domain";
import { usePipeline } from "./pipeline-context";
import {
  holdSubmission,
  moveStage,
  rejectSubmission,
  reopenSubmission,
} from "@/server/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/misc";
import { FormModal } from "./forms/form-shell";
import { ScheduleInterviewModal, type PanelOption } from "./forms/interview-form";
import { OfferFormModal } from "./forms/offer-form";

/**
 * Board cards live several levels deep inside a drag context, so the option
 * lists they need for the schedule / offer dialogs come through context rather
 * than being threaded through every intermediate component.
 */
interface PipelineOptions {
  interviewers: PanelOption[];
  coordinators: PanelOption[];
  /** What the signed-in actor may actually do from a card. */
  capabilities: {
    move: boolean;
    close: boolean;
    schedule: boolean;
    draftOffer: boolean;
  };
}

const DEFAULT_CAPABILITIES = { move: false, close: false, schedule: false, draftOffer: false };

const OptionsContext = createContext<PipelineOptions>({
  interviewers: [],
  coordinators: [],
  capabilities: DEFAULT_CAPABILITIES,
});

export function PipelineOptionsProvider({
  value,
  children,
}: {
  value: PipelineOptions;
  children: ReactNode;
}) {
  return <OptionsContext.Provider value={value}>{children}</OptionsContext.Provider>;
}

export function usePipelineOptions() {
  return useContext(OptionsContext);
}

/* ------------------------------------------------------------------ *
 * Stage move
 * ------------------------------------------------------------------ */

export function MoveStageModal({
  open,
  onClose,
  submissionId,
  candidateName,
  currentStage,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  currentStage: Stage;
}) {
  const router = useRouter();
  const pipeline = usePipeline();
  // Default to the next stage along, which is what the button is nearly always
  // used for; everything else is still one click away in the list.
  const next = pipeline.live[Math.min(pipeline.index(currentStage) + 1, pipeline.live.length - 1)]!;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title="Move candidate"
      description={`${candidateName} is currently in ${pipeline.label(currentStage).toLowerCase()}.`}
      action={moveStage}
      submitLabel="Move"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <Field label="Move to" error={errors.stage}>
            <Select name="stage" defaultValue={next.key}>
              {pipeline.live.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === currentStage}>
                  {s.label}
                  {s.key === currentStage ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" hint="Added to the candidate timeline." error={errors.note}>
            <Textarea name="note" placeholder="Panel aligned on moving forward." />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/* ------------------------------------------------------------------ *
 * Close out
 * ------------------------------------------------------------------ */

export function RejectModal({
  open,
  onClose,
  submissionId,
  candidateName,
  requisitionTitle,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
}) {
  const router = useRouter();

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title="Close this candidate out"
      description={`${candidateName} — ${requisitionTitle}`}
      action={rejectSubmission}
      submitLabel="Close out"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <Field label="Outcome" error={errors.outcome}>
            <Select name="outcome" defaultValue="rejected">
              <option value="rejected">We are passing</option>
              <option value="withdrawn">Candidate withdrew</option>
            </Select>
          </Field>
          <Field
            label="Reason"
            hint="Drives the rejection-reason breakdown in analytics."
            error={errors.reason}
          >
            <Select name="reason" defaultValue={REJECTION_REASONS[0]}>
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" error={errors.note}>
            <Textarea
              name="note"
              placeholder="Context worth keeping if we re-engage this person later."
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/* ------------------------------------------------------------------ *
 * On hold
 * ------------------------------------------------------------------ */

export function HoldModal({
  open,
  onClose,
  submissionId,
  candidateName,
  requisitionTitle,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
}) {
  const router = useRouter();

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title="Put this candidate on hold"
      description={`${candidateName} — ${requisitionTitle}`}
      action={holdSubmission}
      submitLabel="Put on hold"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <p className="text-[13px] leading-relaxed text-content-muted">
            They leave the board but keep their place. Reopening puts them back at
            the stage they are on now, not at the start.
          </p>
          <Field label="Why" hint="Added to the candidate timeline." error={errors.note}>
            <Textarea
              name="note"
              placeholder="Client paused the requirement until the next budget cycle."
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/* ------------------------------------------------------------------ *
 * Reopen
 * ------------------------------------------------------------------ */

/**
 * Bring a held, rejected or withdrawn candidate back into the pipeline.
 *
 * Someone put on hold resumes at the stage they left — the action reads it
 * back off the stage history — so the picker here only matters for a candidate
 * who was closed out and is genuinely restarting.
 */
export function ReopenModal({
  open,
  onClose,
  submissionId,
  candidateName,
  requisitionTitle,
  wasOnHold,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
  wasOnHold: boolean;
}) {
  const router = useRouter();
  const pipeline = usePipeline();

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title="Bring this candidate back"
      description={`${candidateName} — ${requisitionTitle}`}
      action={reopenSubmission}
      submitLabel="Reopen"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          {wasOnHold ? (
            <>
              <input type="hidden" name="stage" value={pipeline.order[1] ?? pipeline.order[0]} />
              <p className="text-[13px] leading-relaxed text-content-muted">
                They go back to the stage they were on when they were put on hold.
              </p>
            </>
          ) : (
            <Field label="Restart at" error={errors.stage}>
              <Select name="stage" defaultValue={pipeline.order[1] ?? pipeline.order[0]}>
                {pipeline.active.map((key) => (
                  <option key={key} value={key}>
                    {pipeline.label(key)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}
    </FormModal>
  );
}

/* ------------------------------------------------------------------ *
 * The card overflow menu
 * ------------------------------------------------------------------ */

type Dialog = "move" | "reject" | "hold" | "reopen" | "interview" | "offer" | null;

export function CardActions({ card }: { card: PipelineCard }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const { interviewers, coordinators, capabilities } = usePipelineOptions();
  // An offer only makes sense once the client has actually seen them.
  const canDraftOffer = usePipeline().atOrPastKind(card.stage, "submitted");

  // Nothing this actor can do from here — do not render a dead menu.
  if (!capabilities.move && !capabilities.close && !capabilities.schedule && !capabilities.draftOffer) {
    return null;
  }

  return (
    <>
      <div className="ml-auto">
        <Menu
          align="right"
          trigger={
            <button
              className="rounded p-1 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
              aria-label={`Actions for ${card.candidateName}`}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        >
          {(close) => (
            <>
              <MenuLabel>{card.candidateName}</MenuLabel>
              {capabilities.move ? (
                <MenuItem
                  icon={<ExternalLink className="size-3.5" />}
                  onClick={() => {
                    close();
                    setDialog("move");
                  }}
                >
                  Move stage…
                </MenuItem>
              ) : null}
              {capabilities.schedule ? (
                <MenuItem
                  icon={<CalendarPlus className="size-3.5" />}
                  onClick={() => {
                    close();
                    setDialog("interview");
                  }}
                >
                  Schedule interview…
                </MenuItem>
              ) : null}
              {capabilities.draftOffer ? (
                <MenuItem
                  icon={<FileSignature className="size-3.5" />}
                  disabled={!canDraftOffer || Boolean(card.offerStatus)}
                  onClick={() => {
                    close();
                    setDialog("offer");
                  }}
                >
                  {card.offerStatus ? "Offer already drafted" : "Draft offer…"}
                </MenuItem>
              ) : null}
              {capabilities.move ? (
                <MenuItem
                  icon={<PauseCircle className="size-3.5" />}
                  onClick={() => {
                    close();
                    setDialog("hold");
                  }}
                >
                  Put on hold…
                </MenuItem>
              ) : null}
              {capabilities.close ? (
                <MenuItem
                  danger
                  icon={<UserMinus className="size-3.5" />}
                  onClick={() => {
                    close();
                    setDialog("reject");
                  }}
                >
                  Close out…
                </MenuItem>
              ) : null}
            </>
          )}
        </Menu>
      </div>

      <MoveStageModal
        open={dialog === "move"}
        onClose={() => setDialog(null)}
        submissionId={card.id}
        candidateName={card.candidateName}
        currentStage={card.stage}
      />
      <RejectModal
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        submissionId={card.id}
        candidateName={card.candidateName}
        requisitionTitle={card.requisitionTitle}
      />
      <HoldModal
        open={dialog === "hold"}
        onClose={() => setDialog(null)}
        submissionId={card.id}
        candidateName={card.candidateName}
        requisitionTitle={card.requisitionTitle}
      />
      <ScheduleInterviewModal
        open={dialog === "interview"}
        onClose={() => setDialog(null)}
        submissionId={card.id}
        candidateName={card.candidateName}
        requisitionTitle={card.requisitionTitle}
        interviewers={interviewers}
        coordinators={coordinators}
        suggestedRound={`Round ${card.interviewCount + 1}`}
      />
      <OfferFormModal
        open={dialog === "offer"}
        onClose={() => setDialog(null)}
        submissionId={card.id}
        candidateName={card.candidateName}
        requisitionTitle={card.requisitionTitle}
      />
    </>
  );
}

/** Inline advance / close-out buttons for list rows outside the board. */
export function RowActions({
  submissionId,
  candidateName,
  requisitionTitle,
  stage,
  status,
}: {
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
  stage: Stage;
  /** Anything other than `active` gets Reopen instead of the working controls. */
  status: string;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const active = status === "active";

  return (
    <>
      <div className="flex items-center gap-1.5">
        {active ? (
          <>
            <Button size="xs" variant="secondary" onClick={() => setDialog("move")}>
              Move
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDialog("hold")}>
              Hold
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDialog("reject")}>
              Close out
            </Button>
          </>
        ) : (
          <Button size="xs" variant="secondary" onClick={() => setDialog("reopen")}>
            <RotateCcw className="size-3" />
            Reopen
          </Button>
        )}
      </div>
      <HoldModal
        open={dialog === "hold"}
        onClose={() => setDialog(null)}
        submissionId={submissionId}
        candidateName={candidateName}
        requisitionTitle={requisitionTitle}
      />
      <ReopenModal
        open={dialog === "reopen"}
        onClose={() => setDialog(null)}
        submissionId={submissionId}
        candidateName={candidateName}
        requisitionTitle={requisitionTitle}
        wasOnHold={status === "on_hold"}
      />
      <MoveStageModal
        open={dialog === "move"}
        onClose={() => setDialog(null)}
        submissionId={submissionId}
        candidateName={candidateName}
        currentStage={stage}
      />
      <RejectModal
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        submissionId={submissionId}
        candidateName={candidateName}
        requisitionTitle={requisitionTitle}
      />
    </>
  );
}
