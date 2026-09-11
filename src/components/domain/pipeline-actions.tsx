"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  ExternalLink,
  FileSignature,
  MoreHorizontal,
  UserMinus,
} from "lucide-react";

import type { PipelineCard } from "@/server/queries/pipeline";
import { PIPELINE_STAGES, REJECTION_REASONS, STAGE, stageIndex, type Stage } from "@/lib/domain";
import { moveStage, rejectSubmission } from "@/server/actions/pipeline";
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
}

const OptionsContext = createContext<PipelineOptions>({ interviewers: [], coordinators: [] });

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
  const next = PIPELINE_STAGES[Math.min(stageIndex(currentStage) + 1, PIPELINE_STAGES.length - 1)]!;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title="Move candidate"
      description={`${candidateName} is currently in ${STAGE[currentStage].label.toLowerCase()}.`}
      action={moveStage}
      submitLabel="Move"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <Field label="Move to" error={errors.stage}>
            <Select name="stage" defaultValue={next.value}>
              {PIPELINE_STAGES.map((s) => (
                <option key={s.value} value={s.value} disabled={s.value === currentStage}>
                  {s.label}
                  {s.value === currentStage ? " (current)" : ""}
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
 * The card overflow menu
 * ------------------------------------------------------------------ */

type Dialog = "move" | "reject" | "interview" | "offer" | null;

export function CardActions({ card }: { card: PipelineCard }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const { interviewers, coordinators } = usePipelineOptions();

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
              <MenuItem
                icon={<ExternalLink className="size-3.5" />}
                onClick={() => {
                  close();
                  setDialog("move");
                }}
              >
                Move stage…
              </MenuItem>
              <MenuItem
                icon={<CalendarPlus className="size-3.5" />}
                onClick={() => {
                  close();
                  setDialog("interview");
                }}
              >
                Schedule interview…
              </MenuItem>
              <MenuItem
                icon={<FileSignature className="size-3.5" />}
                disabled={stageIndex(card.stage) < 2 || Boolean(card.offerStatus)}
                onClick={() => {
                  close();
                  setDialog("offer");
                }}
              >
                {card.offerStatus ? "Offer already drafted" : "Draft offer…"}
              </MenuItem>
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
}: {
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
  stage: Stage;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => setDialog("move")}>
          Move
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setDialog("reject")}>
          Close out
        </Button>
      </div>
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
