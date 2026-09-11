"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, UserRound } from "lucide-react";

import type { User } from "@/db/schema";
import { roleDef } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/misc";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/misc";

export function UserMenu({ actor }: { actor: User }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const role = roleDef(actor.role);

  return (
    <Menu
      align="right"
      className="w-64"
      trigger={
        <button
          className={cn(
            "flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-surface-muted",
            pending && "opacity-60",
          )}
          aria-label="Account menu"
        >
          <Avatar name={actor.name} size="sm" />
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block truncate text-[13px] leading-tight font-medium">{actor.name}</span>
            <span className="block truncate text-[11px] leading-tight text-content-subtle">
              {role?.label ?? actor.role}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-content-subtle" />
        </button>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-border-base px-2.5 pt-1 pb-2.5">
            <p className="text-[13px] font-semibold text-content">{actor.name}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-content-subtle">{actor.email}</p>
            {role ? (
              <p className="mt-2 text-[11.5px] leading-snug text-content-muted">{role.description}</p>
            ) : null}
          </div>

          <MenuLabel>Account</MenuLabel>
          <MenuItem
            icon={<UserRound className="size-3.5" />}
            onClick={() => {
              close();
              router.push(`/team/${actor.id}`);
            }}
          >
            My profile and workload
          </MenuItem>
          <MenuItem
            danger
            icon={<LogOut className="size-3.5" />}
            disabled={pending}
            onClick={() => {
              close();
              startTransition(async () => {
                await signOut();
              });
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
