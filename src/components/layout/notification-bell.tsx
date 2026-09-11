"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { markAllRead, markRead } from "@/server/actions/notifications";
import { cn, relativeTime } from "@/lib/utils";
import { Menu, MenuLabel } from "@/components/ui/misc";

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: Date;
  readAt: Date | null;
  tone: string;
}

/**
 * The notification inbox (§14).
 *
 * Opening an item marks it read and navigates in one gesture, because two
 * clicks to act on a notification is how an inbox turns into a list of things
 * nobody clears.
 */
export function NotificationBell({
  items,
  unread,
}: {
  items: InboxItem[];
  unread: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  function open(item: InboxItem, close: () => void) {
    close();
    // Optimistic: the dot goes immediately, the write catches up.
    if (!item.readAt) setDismissed((prev) => new Set(prev).add(item.id));
    startTransition(async () => {
      if (!item.readAt) await markRead(item.id);
      if (item.href) router.push(item.href);
      else router.refresh();
    });
  }

  const badge = Math.max(0, unread - dismissed.size);

  return (
    <Menu
      align="right"
      className="w-[22rem]"
      trigger={
        <button
          type="button"
          aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
          className="relative rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
        >
          <Bell className="size-[18px]" />
          {badge > 0 ? (
            <span className="absolute top-1 right-1 flex min-w-[15px] items-center justify-center rounded-full bg-[hsl(var(--tone-rose))] px-1 text-[9.5px] leading-[15px] font-semibold text-white tabular-nums">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </button>
      }
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <MenuLabel>Notifications</MenuLabel>
            {badge > 0 ? (
              <button
                type="button"
                className="px-2 text-[11.5px] text-content-subtle hover:text-brand"
                onClick={() => {
                  close();
                  setDismissed(new Set(items.map((i) => i.id)));
                  startTransition(async () => {
                    await markAllRead();
                    router.refresh();
                  });
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-content-subtle">
              Nothing needs you right now.
            </p>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto">
              {items.map((item) => {
                const unreadItem = !item.readAt && !dismissed.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => open(item, close)}
                      className={cn(
                        "flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted",
                        unreadItem && "bg-[hsl(var(--tone-blue-bg))]/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          unreadItem
                            ? `bg-[hsl(var(--tone-${item.tone}))]`
                            : "bg-transparent",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] leading-snug font-medium text-content">
                          {item.title}
                        </span>
                        {item.body ? (
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-content-muted">
                            {item.body}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[10.5px] text-content-subtle">
                          {relativeTime(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Menu>
  );
}
