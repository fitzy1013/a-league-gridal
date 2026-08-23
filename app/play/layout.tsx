import Link from "next/link";

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center">
      <nav className="flex h-16 w-full items-center justify-between border-b border-foreground/10 px-5">
        <div className="flex items-center gap-5 text-sm font-semibold">
          <Link href="/play/daily" className="text-base">
            A-League Grid
          </Link>
          <Link href="/play/daily">Daily</Link>
        </div>
      </nav>
      <div className="flex w-full max-w-5xl flex-1 flex-col p-5">{children}</div>
    </main>
  );
}