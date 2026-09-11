"use client";

import { useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { User } from "@/db/schema";
import { USER_ROLE, type UserRole } from "@/lib/domain";
import { cn, groupBy } from "@/lib/utils";
import { switchActor } from "@/server/actions/misc";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuLabel } from "@/components/ui/misc";

/**
 * No auth provider in this build: the app acts as a chosen member of the
 * talent team so every write is still attributed to a real person.
 */
export function ActorMenu({ actor, people }: { actor: User; people: User[] }) {
  const [pending, startTransition] = useTransition();

  const grouped = groupBy(
    people.filter((p) => p.active),
    (p) => p.role,
  );
  const order: UserRole[] = ["admin", "recruiter", "coordinator", "hiring_manager", "interviewer"];

  const choose = (userId: string, close: () => void) => {
    close();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      await switchActor(fd);
    });
  };

  return (
    <Menu
      align="right"
      className="max-h-[70vh] w-72 overflow-y-auto"
      trigger={
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-surface-muted",
            pending && "opacity-60",
          )}
          aria-label="Switch acting user"
        >
          <Avatar name={actor.name} size="sm" />
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block truncate text-[13px] leading-tight font-medium">{actor.name}</span>
            <span className="block truncate text-[11px] leading-tight text-content-subtle">
              {USER_ROLE[actor.role as UserRole]?.label ?? actor.role}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-content-subtle" />
        </button>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-border-base px-2.5 pb-2.5">
            <p className="pt-1 text-[13px] font-semibold">Acting as</p>
            <p className="mt-0.5 text-[11px] leading-snug text-content-subtle">
              Actions, notes and audit entries are recorded under this person.
            </p>
          </div>
          {order.map((role) =>
            grouped[role]?.length ? (
              <div key={role}>
                <MenuLabel>{USER_ROLE[role].label}</MenuLabel>
                {grouped[role]!.map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    onClick={() => choose(p.id, close)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted"
                  >
                    <Avatar name={p.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight">{p.name}</span>
                      <span className="block truncate text-[11px] leading-tight text-content-subtle">
                        {p.title}
                      </span>
                    </span>
                    {p.id === actor.id ? <Check className="size-3.5 shrink-0 text-brand" /> : null}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </>
      )}
    </Menu>
  );
}
