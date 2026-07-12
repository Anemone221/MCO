/**
 * Parser for pasted skill-plan text.
 *
 * Example:
 *   Gunnery V
 *   Small Hybrid Turret IV
 *   Spaceship Command 5
 *
 * Each line is `<skill name> <level>`, level as a roman numeral (I-V) or a
 * digit (1-5). Blank lines and lines with no valid trailing level token
 * (e.g. a pasted title) are skipped rather than rejected.
 */

export interface ParsedSkillPlanEntry {
  skillName: string;
  level: number;
}

const ROMAN_LEVELS: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
const LINE = /^(.+?)\s+(\S+)$/;

function parseLevelToken(token: string): number | null {
  if (/^[1-5]$/.test(token)) return Number(token);
  return ROMAN_LEVELS[token.toUpperCase()] ?? null;
}

/** Parse pasted skill-plan text into a flat list of skill/level entries. */
export function parseSkillPlan(text: string): ParsedSkillPlanEntry[] {
  if (text.trim().length === 0) throw new Error('Empty plan text');

  const entries: ParsedSkillPlanEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const match = LINE.exec(line);
    if (!match) continue;

    const level = parseLevelToken(match[2]!);
    if (level === null) continue;

    entries.push({ skillName: match[1]!.trim(), level });
  }

  if (entries.length === 0) {
    throw new Error('No valid "skill level" lines found in plan text');
  }

  return entries;
}
