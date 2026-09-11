"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { REQ_STATUSES, REQ_STATUS, type ReqStatus } from "@/lib/domain";
import { changeRequisitionStatus } from "@/server/actions/requisitions";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/misc";
import { Dot } from "@/components/ui/badge";
import { FormModal } from "./forms/form-shell";

export function RequisitionStatusMenu({
  requisitionId,
  current,
}: {
  requisitionId: string;
  current: string;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ReqStatus | null>(null);

  return (
    <>
      <Menu
        align="right"
        trigger={
          <Button variant="secondary" size="sm">
            {REQ_STATUS[current as ReqStatus]?.label ?? current}
            <ChevronDown className="size-3.5" />
          </Button>
        }
      >
        {(close) => (
          <>
            <MenuLabel>Change status</MenuLabel>
            {REQ_STATUSES.map((s) => (
              <MenuItem
                key={s.value}
                icon={<Dot tone={s.tone} />}
                disabled={s.value === current}
                onClick={() => {
                  close();
                  setTarget(s.value);
                }}
              >
                {s.label}
                {s.value === current ? " (current)" : ""}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <FormModal
        open={target !== null}
        onClose={() => setTarget(null)}
        size="sm"
        title="Change requisition status"
        description={
          target
            ? `Moving from ${REQ_STATUS[current as ReqStatus]?.label.toLowerCase()} to ${REQ_STATUS[target].label.toLowerCase()}.`
            : ""
        }
        action={changeRequisitionStatus}
        submitLabel="Update status"
        onSuccess={() => router.refresh()}
      >
        {({ errors }) => (
          <>
            <input type="hidden" name="requisitionId" value={requisitionId} />
            <Field label="New status" error={errors.status}>
              <Select name="status" defaultValue={target ?? current}>
                {REQ_STATUSES.map((s) => (
                  <option key={s.value} value={s.value} disabled={s.value === current}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" hint="Recorded on the requisition timeline." error={errors.reason}>
              <Textarea
                name="reason"
                placeholder="Budget paused until the next planning cycle."
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}
