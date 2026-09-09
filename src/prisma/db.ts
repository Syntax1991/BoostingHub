import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };
import { pgPool } from '@/lib/pg-pool';

export const db = postgres<Contract>({
  contractJson,
  // Prisma 8 vendors its own @types/pg; the runtime object is the same Pool.
  pg: pgPool as never,
});
