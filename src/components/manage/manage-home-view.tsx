import Link from "next/link";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Swords,
  Users,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace, Section } from "@/components/ui/layout";
import { KpiItem, KpiStrip } from "@/components/ui/data-table";
import { CONCRETE_CHARACTER_ROLES } from "@/lib/character-roles";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS } from "@/lib/labels";
import { WOW_CLASSES } from "@/models/enums";
import type { CommunityStats } from "@/services/community-stats.service";
import type { ManagementOverviewCard } from "@/services/management-hub.service";

const ICONS = {
  runs: CalendarDays,
  users: Users,
  characters: Swords,
  system: Activity,
  analytics: BarChart3,
} as const;

function CommunityCoverageSection({ stats }: { stats: CommunityStats }) {
  return (
    <section className="mt-4" aria-labelledby="community-coverage-heading">
      <div className="mb-2">
        <h2 id="community-coverage-heading" className="text-sm font-semibold">
          Community Coverage
        </h2>
        <p className="mt-0.5 text-[11px] text-muted">
          Active approved Boosters and role/class capability of their Characters.
        </p>
      </div>

      <Section>
        <KpiStrip className="mb-0 border-b border-border p-2 xl:grid-cols-4">
          <KpiItem label="Active Boosters" value={stats.activeBoosters} className="border-0 bg-transparent p-1" />
          <KpiItem label="Active Characters" value={stats.activeCharacters} className="border-0 bg-transparent p-1" />
          <KpiItem label="Multi-role Characters" value={stats.multiRole.characters} className="border-0 bg-transparent p-1" />
          <KpiItem label="Multi-role Boosters" value={stats.multiRole.boosters} className="border-0 bg-transparent p-1" />
        </KpiStrip>

        <div className="border-b border-border px-3 py-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">Role coverage</h3>
          <dl className="mt-1.5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
            {CONCRETE_CHARACTER_ROLES.map((role) => (
              <div key={role} className="rounded-md border border-border px-2 py-1.5">
                <dt className="text-xs font-medium">{CHARACTER_ROLE_LABELS[role]}</dt>
                <dd className="mt-0.5 text-[11px] text-muted">
                  <span className="font-semibold tabular-nums text-foreground">
                    {stats.roles[role].characters}
                  </span>{" "}
                  Chars ·{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {stats.roles[role].boosters}
                  </span>{" "}
                  Boosters
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="px-3 py-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">Class coverage</h3>
          <dl className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {WOW_CLASSES.map((wowClass) => (
              <div key={wowClass} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="text-muted">{CLASS_LABELS[wowClass]}</dt>
                <dd className="font-semibold tabular-nums">{stats.classes[wowClass]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
    </section>
  );
}

export function ManageHomeView({
  cards,
  communityStats,
}: {
  cards: ManagementOverviewCard[];
  /** ADMIN / OWNER only. Null for RAID_LEAD. */
  communityStats: CommunityStats | null;
}) {
  return (
    <PageWorkspace>
      <PageHeader
        title="Management"
        description="Operations hub for runs, boosting roles, and administration."
      />
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = ICONS[card.id];
          return (
            <Card key={card.id} className="flex flex-col" flush>
              <div className="flex items-start gap-2 border-b border-border px-3 py-2">
                <div className="mt-0.5 rounded-md bg-accent/15 p-1.5 text-accent">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{card.title}</h2>
                  <p className="mt-0.5 text-[11px] text-muted">{card.description}</p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 px-3 py-2 text-sm">
                {card.metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt className="text-[11px] text-muted">{metric.label}</dt>
                    <dd className="text-base font-semibold tabular-nums leading-tight">{metric.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-auto border-t border-border px-3 py-2">
                <Link
                  href={card.href}
                  className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  {card.cta}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>

      {communityStats ? <CommunityCoverageSection stats={communityStats} /> : null}
    </PageWorkspace>
  );
}
