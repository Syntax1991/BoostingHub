#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract';
import endContract from '../../snapshots/415430a681c72b2ecaaf5c450efc66212913fb8b18e1b315a0a512c21f841031/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/4d4ce8b1eda059f6bcc34ae981987dc111d1f3ab69fd262ce0343b9b8130d144/contract';
import startContract from '../../snapshots/4d4ce8b1eda059f6bcc34ae981987dc111d1f3ab69fd262ce0343b9b8130d144/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run',
        constraint: 'run_lootType_check_3071d052',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_lootType_check_3071d052',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'run_template',
        constraint: 'run_template_lootType_check_3071d052',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run',
        constraint: 'run_lootType_check_5a157d0a',
        expression: "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP', 'COMMUNITY')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_discord_announcement',
        constraint: 'run_discord_announcement_lootType_check_5a157d0a',
        expression: "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP', 'COMMUNITY')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'run_template',
        constraint: 'run_template_lootType_check_5a157d0a',
        expression: "\"lootType\" IN ('SAVED', 'UNSAVED', 'VIP', 'COMMUNITY')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
