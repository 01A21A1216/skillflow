"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NotificationBell, type InboxItem } from "./notification-bell";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronsLeft,
  FileSignature,
  FileSpreadsheet,
  History,
  KanbanSquare,
  LayoutDashboard,
  Menu,
  Settings,
  Sparkles,
  Users,
  UsersRound,
  X,
} from "lucide-react";

import type { User } from "@/db/schema";
import { cn } from "@/lib/utils";
import { setLocalFlag, useLocalFlag } from "@/lib/browser-store";
import { LiveUpdates } from "@/components/live-updates";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./user-menu";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";

const NAV_COLLAPSED_KEY = "rcc-nav-collapsed";

export interface NavCounts {
  requisitions: number;
  pipeline: number;
  interviews: number;
  offers: number;
}

/**
 * Navigation is permission-driven: a link the actor cannot use is not
 * rendered. `anyOf` means "show if the actor holds any of these", which keeps
 * the scoped variants (view.all / view.assigned) from needing special cases.
 */
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  {
    href: "/requisitions",
    label: "Requisitions",
    icon: Briefcase,
    count: "requisitions" as const,
    anyOf: ["requisition.view.all", "requisition.view.assigned"],
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: KanbanSquare,
    count: "pipeline" as const,
    anyOf: ["requisition.view.all", "requisition.view.assigned"],
  },
  {
    href: "/candidates",
    label: "Candidates",
    icon: Users,
    anyOf: ["candidate.view.all", "candidate.view.owned"],
  },
  {
    href: "/interviews",
    label: "Interviews",
    icon: CalendarDays,
    count: "interviews" as const,
    anyOf: ["interview.view.all", "interview.view.own"],
  },
  { href: "/offers", label: "Offers", icon: FileSignature, count: "offers" as const, anyOf: ["offer.view"] },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
];

const NAV_SECONDARY = [
  { href: "/analytics", label: "Analytics", icon: BarChart3, anyOf: ["report.view"] },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet, anyOf: ["report.view"] },
  { href: "/clients", label: "Client accounts", icon: Building2, anyOf: ["client.view"] },
  { href: "/team", label: "Team", icon: UsersRound, anyOf: ["team.view"] },
  { href: "/activity", label: "Activity", icon: History, anyOf: ["audit.view"] },
  { href: "/settings", label: "Settings", icon: Settings, anyOf: ["settings.manage"] },
];

export function AppShell({
  children,
  actor,
  permissions,
  counts,
  notifications,
  unread,
}: {
  children: ReactNode;
  actor: User;
  permissions: string[];
  counts: NavCounts;
  notifications: InboxItem[];
  unread: number;
}) {
  const granted = new Set(permissions);
  const allowed = (item: { anyOf?: string[] }) =>
    !item.anyOf || item.anyOf.some((p) => granted.has(p));
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Read through an external store so the server render (null -> expanded)
  // matches the client exactly and there is no post-mount state cascade.
  const collapsed = useLocalFlag(NAV_COLLAPSED_KEY) ?? false;

  // Close the mobile drawer whenever navigation happens.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  const toggleCollapsed = () => setLocalFlag(NAV_COLLAPSED_KEY, !collapsed);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const navLink = (item: {
    href: string;
    label: string;
    icon: typeof Briefcase;
    exact?: boolean;
    count?: keyof NavCounts;
    anyOf?: string[];
  }) => {
    if (!allowed(item)) return null;
    const active = isActive(item.href, item.exact);
    const Icon = item.icon;
    const badge = item.count ? counts[item.count] : undefined;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
          active
            ? "bg-brand-soft text-brand"
            : "text-content-muted hover:bg-surface-muted hover:text-content",
        )}
      >
        <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        {!collapsed ? (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {badge !== undefined && badge > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  active ? "bg-brand/15 text-brand" : "bg-surface-muted text-content-subtle",
                )}
              >
                {badge}
              </span>
            ) : null}
          </>
        ) : null}
        {active ? (
          <span className="absolute top-1/2 -left-2.5 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />
        ) : null}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* ---------- Sidebar ---------- */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border-base bg-surface transition-[width,transform] duration-200",
          collapsed ? "w-[68px]" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-border-base px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-contrast">
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M4 19V7l5 4 3-6 3 6 5-4v12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="truncate text-[13px] leading-tight font-semibold">Command Center</div>
              <div className="truncate text-[11px] leading-tight text-content-subtle">
                Meridian Talent
              </div>
            </div>
          ) : null}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded p-1 text-content-subtle lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {!collapsed ? (
            <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
              Operate
            </p>
          ) : null}
          {NAV.map(navLink)}

          <div className={cn(NAV_SECONDARY.some(allowed) ? "pt-4" : "hidden")}>
            {!collapsed ? (
              <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                Insight
              </p>
            ) : null}
            {NAV_SECONDARY.map(navLink)}
          </div>
        </nav>

        <div className="shrink-0 border-t border-border-base p-3">
          <button
            onClick={toggleCollapsed}
            className={cn(
              "hidden w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-content-subtle transition-colors hover:bg-surface-muted hover:text-content lg:flex",
              collapsed && "justify-center",
            )}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <ChevronsLeft className={cn("size-[18px] transition-transform", collapsed && "rotate-180")} />
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-[hsl(var(--overlay)/0.5)] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* ---------- Main column ---------- */}
      <div className={cn("flex min-w-0 flex-1 flex-col", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border-base bg-[hsl(var(--surface)/0.85)] px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-[18px]" />
          </Button>

          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <NotificationBell items={notifications} unread={unread} />
            <ThemeToggle />
            <UserMenu actor={actor} />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Keeps this browser in step with everybody else's changes (§1). */}
      <LiveUpdates actorId={actor.id} />
    </div>
  );
}
