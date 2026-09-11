"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in the Recruitment Command Center:", error);
  }, [error]);

  const missingData = /no such table|run .?npm run db:seed/i.test(error.message);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-lg text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[hsl(var(--tone-rose-bg))] text-[hsl(var(--tone-rose))]">
          <AlertTriangle className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-content">
          {missingData ? "The database has not been set up yet" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-content-muted">
          {missingData ? (
            <>
              Run <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">npm run db:reset</code>{" "}
              to create the schema and load the sample recruiting organisation, then reload.
            </>
          ) : (
            "The page could not be rendered. Retrying usually works; if it does not, the details are in the server console."
          )}
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-content-subtle">
            Reference {error.digest}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="primary" size="sm" onClick={reset}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <LinkButton href="/" size="sm">
            Back to the dashboard
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
