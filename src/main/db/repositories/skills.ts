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

export function getTotalSp(characterId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(sp), 0) AS total FROM character_skills WHERE character_id = ?')
    .get(characterId) as { total: number };
  return row.total;
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
