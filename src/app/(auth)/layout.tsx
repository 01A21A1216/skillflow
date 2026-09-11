import type { ReactNode } from "react";

/** Bare, centred shell for sign-in. No navigation, no session requirement. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      {children}
    </div>
  );
}
