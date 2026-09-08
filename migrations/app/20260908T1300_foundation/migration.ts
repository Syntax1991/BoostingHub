#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5ebe22dcdf5e13ef91f4838978ee6cd3e75265fe59d37994ab2fde2fcea9ca5d/contract';
import endContract from '../../snapshots/5ebe22dcdf5e13ef91f4838978ee6cd3e75265fe59d37994ab2fde2fcea9ca5d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'account',
        columns: [
          col('accessToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('accessTokenExpiresAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('accountId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('password', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refreshToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('refreshTokenExpiresAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('scope', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'activity_event',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('message', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurredAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'booster_access',
        columns: [
          col('approvedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('approvedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('characterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('wowClass', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'booster_access_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'booster_access_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
          checkExpression(
            'booster_access_status_check_3260663c',
            "\"status\" IN ('PENDING', 'APPROVED', 'REVOKED')",
          ),
          checkExpression(
            'booster_access_wowClass_check_8876c2a5',
            "\"wowClass\" IN ('DEATH_KNIGHT', 'DEMON_HUNTER', 'DRUID', 'EVOKER', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'character',
        columns: [
          col('blizzardCharacterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isActive', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('itemLevel', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastSyncedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('primaryRole', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('realm', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('region', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('specialization', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('warcraftLogsId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('wowClass', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'character_primaryRole_check_1fa7067b',
            "\"primaryRole\" IN ('TANK', 'HEALER', 'DPS')",
          ),
          checkExpression('character_region_check_0ad0075e', "\"region\" IN ('EU', 'US')"),
          checkExpression(
            'character_wowClass_check_8876c2a5',
            "\"wowClass\" IN ('DEATH_KNIGHT', 'DEMON_HUNTER', 'DRUID', 'EVOKER', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'character_raid_lockout',
        columns: [
          col('bossesDefeated', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('characterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isComplete', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resetIdentifier', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'character_raid_lockout_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raid',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isActive', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('season', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'raid_boss',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'run',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('desiredDpsCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('desiredHealerCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('desiredTankCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('difficulty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('raidId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raidLeadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledStartAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('signupsOpen', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_difficulty_check_05ae26c2',
            "\"difficulty\" IN ('NORMAL', 'HEROIC', 'MYTHIC')",
          ),
          checkExpression(
            'run_status_check_e1302b27',
            "\"status\" IN ('DRAFT', 'OPEN', 'ROSTERING', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_signup',
        columns: [
          col('characterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isBackup', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('lootbuddyWillPlay', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('participationType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_signup_participationType_check_c88ba3d2',
            "\"participationType\" IN ('BOOSTER', 'LOOTBUDDY')",
          ),
          checkExpression(
            'run_signup_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
          checkExpression(
            'run_signup_status_check_d46a9d36',
            "\"status\" IN ('PENDING', 'SELECTED', 'NOT_SELECTED', 'WITHDRAWN')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'session',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ipAddress', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userAgent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('accountRole', 'text', {
            notNull: true,
            default: lit('USER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('accountStatus', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('discordUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('discordUsername', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('emailVerified', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('image', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'user_accountRole_check_bf325bd2',
            "\"accountRole\" IN ('USER', 'RAID_LEAD', 'ADMIN')",
          ),
          checkExpression(
            'user_accountStatus_check_1cc0af98',
            "\"accountStatus\" IN ('ACTIVE', 'DISABLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'verification',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('identifier', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'booster_access',
        constraint: 'booster_access_userId_wowClass_role_difficulty_key',
        columns: ['userId', 'wowClass', 'role', 'difficulty'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'character_raid_lockout',
        constraint: 'character_raid_lockout_characterId_raidId_difficulty_resetIdentifier_key',
        columns: ['characterId', 'raidId', 'difficulty', 'resetIdentifier'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_signup',
        constraint: 'run_signup_runId_userId_characterId_participationType_key',
        columns: ['runId', 'userId', 'characterId', 'participationType'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'session',
        constraint: 'session_token_key',
        columns: ['token'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'user_email_key',
        columns: ['email'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'user_discordUserId_key',
        columns: ['discordUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'account',
        index: 'account_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'activity_event',
        index: 'activity_event_occurredAt_idx_c6b89167',
        columns: ['occurredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'activity_event',
        index: 'activity_event_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_access',
        index: 'booster_access_approvedById_idx_01ef8410',
        columns: ['approvedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_access',
        index: 'booster_access_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'booster_access',
        index: 'booster_access_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character',
        index: 'character_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_raid_lockout',
        index: 'character_raid_lockout_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'character_raid_lockout',
        index: 'character_raid_lockout_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raid_boss',
        index: 'raid_boss_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_raidId_idx_996eeca9',
        columns: ['raidId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_raidLeadId_idx_e271c2cb',
        columns: ['raidLeadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_scheduledStartAt_idx_16bf47c9',
        columns: ['scheduledStartAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run',
        index: 'run_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_signup',
        index: 'run_signup_characterId_idx_2423fe9d',
        columns: ['characterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_signup',
        index: 'run_signup_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_signup',
        index: 'run_signup_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'session_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'account',
        foreignKey: {
          name: 'account_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'activity_event',
        foreignKey: {
          name: 'activity_event_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_access',
        foreignKey: {
          name: 'booster_access_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_access',
        foreignKey: {
          name: 'booster_access_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'booster_access',
        foreignKey: {
          name: 'booster_access_approvedById_fkey',
          columns: ['approvedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character',
        foreignKey: {
          name: 'character_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_raid_lockout',
        foreignKey: {
          name: 'character_raid_lockout_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'character_raid_lockout',
        foreignKey: {
          name: 'character_raid_lockout_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raid_boss',
        foreignKey: {
          name: 'raid_boss_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run',
        foreignKey: {
          name: 'run_raidId_fkey',
          columns: ['raidId'],
          references: { schema: 'public', table: 'raid', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run',
        foreignKey: {
          name: 'run_raidLeadId_fkey',
          columns: ['raidLeadId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_signup',
        foreignKey: {
          name: 'run_signup_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_signup',
        foreignKey: {
          name: 'run_signup_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_signup',
        foreignKey: {
          name: 'run_signup_characterId_fkey',
          columns: ['characterId'],
          references: { schema: 'public', table: 'character', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'session',
        foreignKey: {
          name: 'session_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
