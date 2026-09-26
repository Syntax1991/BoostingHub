import { orm } from "@/lib/prisma";
import { asString } from "@/lib/persistence";

export const activityRepository = {
  async listRecent(limit = 8) {
    const rows = await orm.ActivityEvent
      .include("user")
      .orderBy((event) => event.occurredAt.desc())
      .limit(limit)
      .all();

    return rows.map((row) => {
      const event = row as Record<string, unknown>;
      const user = event.user ? (event.user as Record<string, unknown>) : null;
      return {
        id: asString(event.id),
        type: asString(event.type),
        message: asString(event.message),
        occurredAt: asString(event.occurredAt),
        user: user ? { name: asString(user.name, "System") } : null,
      };
    });
  },

  /** Most recent event of one type (e.g. the bulk force-refresh cooldown marker). */
  async findLatestByType(type: string): Promise<{ id: string; occurredAt: string } | null> {
    const row = (await orm.ActivityEvent.where({ type })
      .orderBy((event) => event.occurredAt.desc())
      .select("id", "occurredAt")
      .first()) as Record<string, unknown> | null;
    return row ? { id: asString(row.id), occurredAt: asString(row.occurredAt) } : null;
  },

  async create(input: { userId: string; type: string; message: string }) {
    await orm.ActivityEvent.create({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      message: input.message,
      occurredAt: new Date().toISOString(),
    });
  },
};
