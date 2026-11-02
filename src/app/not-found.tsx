import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <PageHeader title="Page not found" description="That page does not exist or has moved." />
      <Link href="/dashboard" className="text-sm underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
