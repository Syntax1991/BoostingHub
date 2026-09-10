import Link from "next/link";
import {
  CalendarDays,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import type { ManagementOverviewCard } from "@/services/management-hub.service";

const ICONS = {
  runs: CalendarDays,
  "booster-access": ShieldCheck,
  users: Users,
} as const;

export function ManageHomeView({ cards }: { cards: ManagementOverviewCard[] }) {
  return (
    <div>
      <PageHeader
        title="Management"
        description="Operations hub for runs, booster qualifications, and account administration."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = ICONS[card.id];
          return (
            <Card key={card.id} className="flex flex-col">
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <div className="mt-0.5 rounded-md bg-accent/15 p-2 text-accent">
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{card.title}</h2>
                  <p className="mt-1 text-xs text-muted">{card.description}</p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
                {card.metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt className="text-xs text-muted">{metric.label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{metric.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-auto border-t border-border px-4 py-3">
                <Link
                  href={card.href}
                  className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
                >
                  {card.cta}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
