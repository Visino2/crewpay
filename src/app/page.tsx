import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">CrewPay</h1>
      <p className="text-sm text-muted-foreground">
        Contractor pay runs with approvals and a full audit trail.
      </p>
      <Link href="/sign-in" className="text-sm font-medium underline underline-offset-4">
        Sign in
      </Link>
    </main>
  );
}
