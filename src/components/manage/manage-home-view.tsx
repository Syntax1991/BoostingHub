import Link from "next/link";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Swords,
  Users,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
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
    <section className="mt-8" aria-labelledby="community-coverage-heading">
      <div className="mb-3">
        <h2 id="community-coverage-heading" className="text-base font-semibold">
          Community Coverage
        </h2>
        <p className="mt-1 text-sm text-muted">
          Active approved Boosters and the role/class capability of their active Characters.
        </p>
      </div>

      <Card className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-3 border-b border-border px-4 py-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Active Boosters</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{stats.activeBoosters}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Active Characters</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{stats.activeCharacters}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Multi-role Characters</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{stats.multiRole.characters}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Multi-role Boosters</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{stats.multiRole.boosters}</dd>
          </div>
        </dl>

        <div className="border-b border-border px-4 py-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Role coverage</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CONCRETE_CHARACTER_ROLES.map((role) => (
              <div key={role} className="rounded-md border border-border px-3 py-2">
                <dt className="text-sm font-medium">{CHARACTER_ROLE_LABELS[role]}</dt>
                <dd className="mt-1 text-sm text-muted">
                  <span className="font-semibold tabular-nums text-foreground">
                    {stats.roles[role].characters}
                  </span>{" "}
                  Characters ·{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {stats.roles[role].boosters}
                  </span>{" "}
                  Boosters
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="px-4 py-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Class coverage</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {WOW_CLASSES.map((wowClass) => (
              <div key={wowClass} className="flex items-baseline justify-between gap-2 text-sm">
                <dt className="text-muted">{CLASS_LABELS[wowClass]}</dt>
                <dd className="font-semibold tabular-nums">{stats.classes[wowClass]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
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
    <div>
      <PageHeader
        title="Management"
        description="Operations hub for runs, boosting roles, and account administration."
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

      {communityStats ? <CommunityCoverageSection stats={communityStats} /> : null}
    </div>
  );
}
