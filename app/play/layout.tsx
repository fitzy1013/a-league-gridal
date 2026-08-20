import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { hasEnvVars } from "@/lib/utils";

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center">
      <nav className="flex h-16 w-full items-center justify-between border-b border-foreground/10 px-5">
        <div className="flex items-center gap-5 text-sm font-semibold">
          <Link href="/play/daily" className="text-base">
            A-League Grid
          </Link>
          <Link href="/play/daily">Daily</Link>
          <Link href="/play/unlimited">Unlimited</Link>
          {hasEnvVars && <Link href="/protected/stats">Stats</Link>}
        </div>
        <div className="flex items-center gap-2">
          {hasEnvVars ? (
            <Suspense>
              <AuthButton />
            </Suspense>
          ) : (
            <Link href="/auth/login" className="text-sm">
              Sign in
            </Link>
          )}
        </div>
      </nav>
      <div className="flex w-full max-w-5xl flex-1 flex-col p-5">{children}</div>
    </main>
  );
}