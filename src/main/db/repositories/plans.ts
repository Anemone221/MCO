import type { SkillPlan } from '@shared/types';
import { getDb } from '../index';

interface SkillPlanRow {
  id: number;
  name: string;
  plan_text: string;
  imported_at: string;
  show_on_character_sheet: number;
}

function toSkillPlan(row: SkillPlanRow): SkillPlan {
  return {
    id: row.id,
    name: row.name,
    planText: row.plan_text,
    importedAt: row.imported_at,
    showOnCharacterSheet: row.show_on_character_sheet === 1,
  };
}

const COLUMNS = 'id, name, plan_text, imported_at, show_on_character_sheet';

export function listPlans(): SkillPlan[] {
  const rows = getDb()
    .prepare(`SELECT ${COLUMNS} FROM skill_plans ORDER BY imported_at DESC`)
    .all() as SkillPlanRow[];
  return rows.map(toSkillPlan);
}

export function getPlan(id: number): SkillPlan | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM skill_plans WHERE id = ?`).get(id) as
    | SkillPlanRow
    | undefined;
  return row ? toSkillPlan(row) : null;
}

export function createPlan(input: { name: string; planText: string }): SkillPlan {
  const info = getDb()
    .prepare('INSERT INTO skill_plans (name, plan_text) VALUES (@name, @planText)')
    .run(input);
  return getPlan(Number(info.lastInsertRowid))!;
}

/**
 * Overwrite a plan's name and skills in place, so every group priority and
 * character-sheet reference keeps pointing at the edited plan. `imported_at`
 * deliberately stays the creation time.
 */
export function updatePlan(id: number, input: { name: string; planText: string }): SkillPlan | null {
  getDb()
    .prepare('UPDATE skill_plans SET name = @name, plan_text = @planText WHERE id = @id')
    .run({ ...input, id });
  return getPlan(id);
}

/**
 * Show or hide a plan on the character sheets' "Skill plans" card. Nothing
 * else reads the flag: the plan keeps its detail page, its group priority and
 * its place in the plan list either way.
 */
export function setPlanSheetVisibility(id: number, show: boolean): SkillPlan | null {
  getDb()
    .prepare('UPDATE skill_plans SET show_on_character_sheet = @show WHERE id = @id')
    .run({ id, show: show ? 1 : 0 });
  return getPlan(id);
}

export function removePlan(id: number): void {
  getDb().prepare('DELETE FROM skill_plans WHERE id = ?').run(id);
}
