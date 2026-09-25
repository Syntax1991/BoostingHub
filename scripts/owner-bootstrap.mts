import "dotenv/config";
import { isDomainError } from "@/lib/errors";
import { ownerBootstrapService } from "@/services/owner-bootstrap.service";

/**
 * One-time Platform Owner bootstrap (see docs/features/user-management.md
 * § Platform Owner):
 *
 *   npm run owner:bootstrap -- --user-id <uuid>
 *
 * Uses DATABASE_URL from the environment/.env like every other app process.
 * Refuses unless the User exists, is ACTIVE and ADMIN, and no OWNER exists yet.
 */
function readUserId(argv: string[]): string | null {
  const index = argv.indexOf("--user-id");
  if (index !== -1) return argv[index + 1] ?? null;
  const inline = argv.find((arg) => arg.startsWith("--user-id="));
  return inline ? inline.slice("--user-id=".length) : null;
}

const userId = readUserId(process.argv.slice(2));
if (!userId) {
  console.error("Usage: npm run owner:bootstrap -- --user-id <uuid>");
  process.exit(2);
}

try {
  const result = await ownerBootstrapService.bootstrap({ userId });
  console.log(`Platform Owner bootstrapped: ${result.name} (${result.userId}) ${result.previousRole} → OWNER.`);
  process.exit(0);
} catch (error) {
  if (isDomainError(error)) {
    console.error(`Owner bootstrap refused [${error.code}]: ${error.message}`);
    process.exit(1);
  }
  console.error("Owner bootstrap failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
