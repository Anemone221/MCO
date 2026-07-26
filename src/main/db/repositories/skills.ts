import type { SkillGroupSp } from '@shared/types';
import { getDb } from '../index';

export interface SkillRow {
  skillTypeId: number;
  sp: number;
  trainedLevel: number;
  activeLevel: number;
}

export interface QueueRow {
  position: number;
  skillTypeId: number;
  finishLevel: number;
  startDate: string | null;
  finishDate: string | null;
}

/** Replace the full trained-skill set for a character in one transaction. */
export function replaceSkills(characterId: number, skills: SkillRow[]): void {
  const db = getDb();
  const del = db.prepare('DELETE FROM character_skills WHERE character_id = ?');
  const ins = db.prepare(
    `INSERT INTO character_skills (character_id, skill_type_id, sp, trained_level, active_level)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(characterId);
    for (const s of skills) {
      ins.run(characterId, s.skillTypeId, s.sp, s.trainedLevel, s.activeLevel);
    }
  })();
}

/** Replace the full skill queue for a character in one transaction. */
export function replaceQueue(characterId: number, queue: QueueRow[]): void {
  const db = getDb();
  const del = db.prepare('DELETE FROM skill_queue WHERE character_id = ?');
  const ins = db.prepare(
    `INSERT INTO skill_queue (character_id, position, skill_type_id, finish_level, start_date, finish_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(characterId);
    for (const q of queue) {
      ins.run(characterId, q.position, q.skillTypeId, q.finishLevel, q.startDate, q.finishDate);
    }
  })();
}

interface QueueDbRow {
  position: number;
  skill_type_id: number;
  finish_level: number;
  start_date: string | null;
  finish_date: string | null;
}

export function getQueue(characterId: number): QueueRow[] {
  const rows = getDb()
    .prepare(
      `SELECT position, skill_type_id, finish_level, start_date, finish_date
       FROM skill_queue WHERE character_id = ? ORDER BY position`,
    )
    .all(characterId) as QueueDbRow[];
  return rows.map((r) => ({
    position: r.position,
    skillTypeId: r.skill_type_id,
    finishLevel: r.finish_level,
    startDate: r.start_date,
    finishDate: r.finish_date,
  }));
}

/**
 * Trained SP per skill group for one character, biggest first. Each trained
 * skill maps to its SDE group (all of which live in the Skills category), so
 * the join needs no category filter. Returns [] when the character has no
 * skills or the SDE has not been imported yet (the type/group tables are empty).
 */
export function getCharacterSkillGroupSp(characterId: number): SkillGroupSp[] {
  const rows = getDb()
    .prepare(
      `SELECT g.name AS group_name, SUM(cs.sp) AS sp
       FROM character_skills cs
       JOIN sde_types t ON cs.skill_type_id = t.id
       JOIN sde_groups g ON t.group_id = g.id
       WHERE cs.character_id = ?
       GROUP BY g.id
       ORDER BY sp DESC`,
    )
    .all(characterId) as Array<{ group_name: string; sp: number }>;
  return rows.map((r) => ({ group: r.group_name, sp: r.sp }));
}

export function getTotalSp(characterId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(sp), 0) AS total FROM character_skills WHERE character_id = ?')
    .get(characterId) as { total: number };
  return row.total;
}

/** Active level of one skill for one character (0 when not injected). */
export function getActiveSkillLevel(characterId: number, skillTypeId: number): number {
  const row = getDb()
    .prepare(
      'SELECT active_level FROM character_skills WHERE character_id = ? AND skill_type_id = ?',
    )
    .get(characterId, skillTypeId) as { active_level: number } | undefined;
  return row?.active_level ?? 0;
}

/** Active level of one skill for every character that has it injected. */
export function getActiveSkillLevels(skillTypeId: number): Map<number, number> {
  const rows = getDb()
    .prepare('SELECT character_id, active_level FROM character_skills WHERE skill_type_id = ?')
    .all(skillTypeId) as Array<{ character_id: number; active_level: number }>;
  return new Map(rows.map((r) => [r.character_id, r.active_level]));
}

export interface CharacterSkill {
  sp: number;
  trainedLevel: number;
}

/** All trained skills for a character, keyed by skill type id. */
export function getCharacterSkillMap(characterId: number): Map<number, CharacterSkill> {
  const rows = getDb()
    .prepare(
      'SELECT skill_type_id, sp, trained_level FROM character_skills WHERE character_id = ?',
    )
    .all(characterId) as Array<{ skill_type_id: number; sp: number; trained_level: number }>;
  const map = new Map<number, CharacterSkill>();
  for (const r of rows) map.set(r.skill_type_id, { sp: r.sp, trainedLevel: r.trained_level });
  return map;
}
