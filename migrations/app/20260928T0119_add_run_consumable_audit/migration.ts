#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/37e097bda2e9e2c75d25347fc19a95d7e6e7a0d3cacbb3ce755a0cc71d5f078f/contract';
import endContract from '../../snapshots/37e097bda2e9e2c75d25347fc19a95d7e6e7a0d3cacbb3ce755a0cc71d5f078f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e1ac07b6a810888d26608cd1f136488065c3f2f75ba486dc7385fb932159ca95/contract';
import startContract from '../../snapshots/e1ac07b6a810888d26608cd1f136488065c3f2f75ba486dc7385fb932159ca95/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'run_consumable_audit',
        columns: [
          col('analyzedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('analyzedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('autoAnalyzed', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('autoAttempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastAttemptAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('lastFailure', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_consumable_audit_lastFailure_check_314da778',
            "\"lastFailure\" IN ('NOT_CONFIGURED', 'REPORT_NOT_FOUND', 'NO_RELEVANT_FIGHTS', 'WCL_UNAVAILABLE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        columns: [
          col('auditId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('difficulty', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('encounterId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('encounterName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('endMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('healthstoneUseSeen', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kill', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('raidContentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reportCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('warlockPresent', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('wclFightId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        columns: [
          col('fightId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('gemCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('itemId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('permanentEnchantId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('playerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slot', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('socketCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('temporaryEnchantId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        columns: [
          col('atMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fightId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('spellId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_consumable_audit_observation_kind_check_3b54a688',
            "\"kind\" IN ('COMBATANT', 'PARTICIPANT', 'AURA', 'CAST', 'DEATH')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_consumable_audit_player',
        columns: [
          col('attendanceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('auditId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('characterName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('characterRealm', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalBoosterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('matchStatus', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('wclActorId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('wowClass', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_consumable_audit_player_matchStatus_check_696e4faa',
            "\"matchStatus\" IN ('MATCHED', 'NOT_IN_LOG', 'NO_CHARACTER_IDENTITY')",
          ),
          checkExpression(
            'run_consumable_audit_player_role_check_b1616ae6',
            "\"role\" IN ('TANK', 'HEALER', 'DPS')",
          ),
          checkExpression(
            'run_consumable_audit_player_wowClass_check_8876c2a5',
            "\"wowClass\" IN ('DEATH_KNIGHT', 'DEMON_HUNTER', 'DRUID', 'EVOKER', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        columns: [
          col('associationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('decidedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('decision', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('difficulty', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('encounterId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('encounterName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('endAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('endMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kill', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('raidContentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reasons', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rosterMatched', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('rosterSize', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('startMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('wclFightId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_warcraft_logs_fight_decision_check_74dec442',
            "\"decision\" IN ('AUTO', 'MANUAL')",
          ),
          checkExpression(
            'run_warcraft_logs_fight_status_check_5ab4ac22',
            "\"status\" IN ('ASSIGNED', 'NEEDS_REVIEW', 'IGNORED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('discordAuthorId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('discordMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastScannedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('reportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', {
            notNull: true,
            default: lit('MANUAL'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'run_warcraft_logs_report_source_check_fe9f0840',
            "\"source\" IN ('MANUAL', 'DISCORD_BOT')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'warcraft_logs_report',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('endAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('fetchedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadataJson', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('regionSlug', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'run',
        column: col('completedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'run_discord_post',
        column: col('warcraftLogsScanCursor', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_consumable_audit',
        constraint: 'run_consumable_audit_runId_key',
        columns: ['runId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        constraint: 'run_consumable_audit_fight_auditId_reportCode_wclFightId_key',
        columns: ['auditId', 'reportCode', 'wclFightId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        constraint: 'run_consumable_audit_gear_item_playerId_fightId_slot_key',
        columns: ['playerId', 'fightId', 'slot'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        constraint: 'run_warcraft_logs_fight_runId_reportId_wclFightId_key',
        columns: ['runId', 'reportId', 'wclFightId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        constraint: 'run_warcraft_logs_report_runId_reportId_key',
        columns: ['runId', 'reportId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'warcraft_logs_report',
        constraint: 'warcraft_logs_report_code_key',
        columns: ['code'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit',
        index: 'run_consumable_audit_analyzedById_idx_5971943a',
        columns: ['analyzedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        index: 'run_consumable_audit_fight_auditId_idx_424ad2e6',
        columns: ['auditId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        index: 'run_consumable_audit_fight_raidContentId_idx_ecf49528',
        columns: ['raidContentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        index: 'run_consumable_audit_gear_item_fightId_idx_16bc93bc',
        columns: ['fightId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        index: 'run_consumable_audit_gear_item_playerId_idx_710cf1aa',
        columns: ['playerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        index: 'run_consumable_audit_observation_fightId_idx_16bc93bc',
        columns: ['fightId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        index: 'run_consumable_audit_observation_playerId_idx_710cf1aa',
        columns: ['playerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_player',
        index: 'run_consumable_audit_player_attendanceId_idx_b259ff3f',
        columns: ['attendanceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_player',
        index: 'run_consumable_audit_player_auditId_idx_424ad2e6',
        columns: ['auditId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_consumable_audit_player',
        index: 'run_consumable_audit_player_externalBoosterId_idx_7e719f2c',
        columns: ['externalBoosterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_warcraft_logs_fight_associationId_idx_54f3505c',
        columns: ['associationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_warcraft_logs_fight_decidedById_idx_8194d55f',
        columns: ['decidedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_warcraft_logs_fight_raidContentId_idx_ecf49528',
        columns: ['raidContentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_warcraft_logs_fight_reportId_idx_d163019e',
        columns: ['reportId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_warcraft_logs_fight_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        index: 'run_wcl_fight_assigned_once_0a75a9c0',
        columns: ['reportId', 'wclFightId'],
        extras: { where: '("status" = \'ASSIGNED\'::text)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        index: 'run_warcraft_logs_report_createdById_idx_8bf640ed',
        columns: ['createdById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        index: 'run_warcraft_logs_report_reportId_idx_d163019e',
        columns: ['reportId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        index: 'run_warcraft_logs_report_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit',
        foreignKey: {
          name: 'run_consumable_audit_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit',
        foreignKey: {
          name: 'run_consumable_audit_analyzedById_fkey',
          columns: ['analyzedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        foreignKey: {
          name: 'run_consumable_audit_fight_auditId_fkey',
          columns: ['auditId'],
          references: { schema: 'public', table: 'run_consumable_audit', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_fight',
        foreignKey: {
          name: 'run_consumable_audit_fight_raidContentId_fkey',
          columns: ['raidContentId'],
          references: { schema: 'public', table: 'run_raid_content', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        foreignKey: {
          name: 'run_consumable_audit_gear_item_playerId_fkey',
          columns: ['playerId'],
          references: { schema: 'public', table: 'run_consumable_audit_player', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_gear_item',
        foreignKey: {
          name: 'run_consumable_audit_gear_item_fightId_fkey',
          columns: ['fightId'],
          references: { schema: 'public', table: 'run_consumable_audit_fight', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        foreignKey: {
          name: 'run_consumable_audit_observation_playerId_fkey',
          columns: ['playerId'],
          references: { schema: 'public', table: 'run_consumable_audit_player', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_observation',
        foreignKey: {
          name: 'run_consumable_audit_observation_fightId_fkey',
          columns: ['fightId'],
          references: { schema: 'public', table: 'run_consumable_audit_fight', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_player',
        foreignKey: {
          name: 'run_consumable_audit_player_auditId_fkey',
          columns: ['auditId'],
          references: { schema: 'public', table: 'run_consumable_audit', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_player',
        foreignKey: {
          name: 'run_consumable_audit_player_attendanceId_fkey',
          columns: ['attendanceId'],
          references: { schema: 'public', table: 'run_attendance', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_consumable_audit_player',
        foreignKey: {
          name: 'run_consumable_audit_player_externalBoosterId_fkey',
          columns: ['externalBoosterId'],
          references: { schema: 'public', table: 'run_external_booster', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        foreignKey: {
          name: 'run_warcraft_logs_fight_associationId_fkey',
          columns: ['associationId'],
          references: { schema: 'public', table: 'run_warcraft_logs_report', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        foreignKey: {
          name: 'run_warcraft_logs_fight_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        foreignKey: {
          name: 'run_warcraft_logs_fight_reportId_fkey',
          columns: ['reportId'],
          references: { schema: 'public', table: 'warcraft_logs_report', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        foreignKey: {
          name: 'run_warcraft_logs_fight_raidContentId_fkey',
          columns: ['raidContentId'],
          references: { schema: 'public', table: 'run_raid_content', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_fight',
        foreignKey: {
          name: 'run_warcraft_logs_fight_decidedById_fkey',
          columns: ['decidedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        foreignKey: {
          name: 'run_warcraft_logs_report_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        foreignKey: {
          name: 'run_warcraft_logs_report_reportId_fkey',
          columns: ['reportId'],
          references: { schema: 'public', table: 'warcraft_logs_report', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'run_warcraft_logs_report',
        foreignKey: {
          name: 'run_warcraft_logs_report_createdById_fkey',
          columns: ['createdById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
