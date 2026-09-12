"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { runJobsNow } from "@/server/actions/settings";

/**
 * Run one pass of the queue without waiting for the next poll.
 *
 * The point is diagnostic: an administrator who has just configured a
 * provider, or who suspects nothing is running, gets an answer in a second
 * rather than in fifteen minutes of watching a table.
 */
export function RunJobsButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function run() {
    setBusy(true);
    const result = await runJobsNow({ ok: false }, new FormData());
    setBusy(false);
    toast(
      result.ok
        ? { kind: "success", title: result.message ?? "Queue run" }
        : { kind: "error", title: "Could not run the queue", description: result.message },
    );
    router.refresh();
  }

  return (
    <Button size="sm" variant="secondary" onClick={run} loading={busy}>
      <Play className="size-3.5" />
      Run now
    </Button>
  );
}
