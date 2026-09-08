import { db } from "@/prisma/db";

/**
 * Prisma 8 namespaces PostgreSQL models under the schema name.
 * Views and controllers must not import this module.
 */
export const orm = db.orm.public;
export { db };
