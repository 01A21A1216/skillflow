import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { listUsers } from "@/server/queries/people";
import {
  activePipelineCount,
  openOfferCount,
  openRequisitionCount,
} from "@/server/queries/dashboard";
import { listInterviews } from "@/server/queries/interviews";
import { currentUser } from "@/server/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Recruitment Command Center",
    template: "%s · Recruitment Command Center",
  },
  description:
    "Centralised applicant tracking for requisitions, candidates, interviews, offers and hiring analytics.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

/** Applied before paint so the first frame is already in the right theme. */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem('rcc-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (stored !== 'light' && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [actor, people] = await Promise.all([currentUser(), Promise.resolve(listUsers())]);

  const upcoming = listInterviews({ window: "week" });
  const counts = {
    requisitions: openRequisitionCount(),
    pipeline: activePipelineCount(),
    interviews: upcoming.length,
    offers: openOfferCount(),
  };

  return (
    // `html` is suppressed because THEME_BOOTSTRAP adds the `dark` class to
    // documentElement before React hydrates — a mismatch we create on purpose.
    // `body` is suppressed because extensions (Grammarly, password managers,
    // translation tools) inject attributes onto it before hydration. Both flags
    // are shallow: they cover only that element's own attributes and text, not
    // the subtree, so real hydration bugs inside the app still surface.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body suppressHydrationWarning>
        <ToastProvider>
          <AppShell actor={actor} people={people} counts={counts}>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
