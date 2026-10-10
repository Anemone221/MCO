import { describe, expect, it } from 'vitest';
import type {
  NeuralAttributes,
  PlanDraftEntry,
  PlanSkillInfo,
  TrainingAttribute,
} from '@shared/types';
import { BALANCED_ATTRIBUTES, spPerMinute } from '@shared/training';
import { spForLevel } from '@main/fits/analyze';
import {
  addRequirements,
  breaksGroupStandard,
  draftIssues,
  draftText,
  draftTotals,
  dropEntry,
  entryAttributes,
  entryKey,
  entrySpCosts,
  entryTimeCosts,
  expandLevels,
  filterGroups,
  groupSkills,
  lowerSkill,
  mergeSkills,
  moveEntry,
  optimizeAllAttributes,
  optimizeAttributes,
  planLevel,
  raiseSkill,
  removeEntry,
  removeFromLevel,
  remapCount,
  remapSegments,
  setRemap,
  sortByPrereqs,
  type SkillMap,
} from '@renderer/lib/planDraft';

/**
 * A small stand-in skill tree:
 *   Gunnery (rank 1)                — no prerequisites
 *   Small Hybrid Turret (rank 1)    — Gunnery I
 *   Medium Hybrid Turret (rank 3)   — Small Hybrid Turret III
 *   Spaceship Command (rank 1)      — no prerequisites
 *   Gallente Frigate (rank 2)       — Spaceship Command I
 * The two Spaceship Command skills train Int/Mem here so the group-standard
 * tests have a deviation to find.
 */
function skill(
  skillTypeId: number,
  name: string,
  rank: number,
  prereqs: Array<{ skillTypeId: number; level: number }> = [],
  attributes: [TrainingAttribute, TrainingAttribute] = ['perception', 'willpower'],
  group: [number, string] = [255, 'Gunnery'],
): PlanSkillInfo {
  return {
    skillTypeId,
    name,
    groupId: group[0],
    groupName: group[1],
    rank,
    primaryAttribute: attributes[0],
    secondaryAttribute: attributes[1],
    spAtLevel: [1, 2, 3, 4, 5].map((level) => spForLevel(rank, level)),
    description: null,
    prereqs,
    published: true,
  };
}

const GUNNERY = 3300;
const SMALL_HYBRID = 3301;
const MEDIUM_HYBRID = 3302;
const SPACESHIP_COMMAND = 3327;
const GALLENTE_FRIGATE = 3328;
const CALDARI_FRIGATE = 3330;

const SHIPS: [number, string] = [257, 'Spaceship Command'];

const CATALOG: PlanSkillInfo[] = [
  skill(GUNNERY, 'Gunnery', 1),
  skill(SMALL_HYBRID, 'Small Hybrid Turret', 1, [{ skillTypeId: GUNNERY, level: 1 }]),
  skill(MEDIUM_HYBRID, 'Medium Hybrid Turret', 3, [{ skillTypeId: SMALL_HYBRID, level: 3 }]),
  skill(SPACESHIP_COMMAND, 'Spaceship Command', 1, [], ['perception', 'willpower'], SHIPS),
  skill(
    CALDARI_FRIGATE,
    'Caldari Frigate',
    2,
    [{ skillTypeId: SPACESHIP_COMMAND, level: 1 }],
    ['perception', 'willpower'],
    SHIPS,
  ),
  // The odd one out: its group trains Per/Wil, this one doesn't.
  skill(
    GALLENTE_FRIGATE,
    'Gallente Frigate',
    2,
    [{ skillTypeId: SPACESHIP_COMMAND, level: 1 }],
    ['intelligence', 'memory'],
    SHIPS,
  ),
];

const SKILLS: SkillMap = mergeSkills(new Map(), CATALOG);

function names(entries: readonly PlanDraftEntry[]): string[] {
  return entries.map((entry) => `${entry.skillName} ${entry.level}`);
}

describe('raiseSkill', () => {
  it('queues one row per level, prerequisites first', () => {
    let entries: PlanDraftEntry[] = [];
    for (let i = 0; i < 3; i += 1) entries = raiseSkill(entries, SMALL_HYBRID, SKILLS);

    expect(names(entries)).toEqual([
      'Gunnery 1',
      'Small Hybrid Turret 1',
      'Small Hybrid Turret 2',
      'Small Hybrid Turret 3',
    ]);
  });

  it('adds only the next level once a skill is already queued', () => {
    const once = raiseSkill([], GUNNERY, SKILLS);

    expect(names(raiseSkill(once, GUNNERY, SKILLS))).toEqual(['Gunnery 1', 'Gunnery 2']);
  });

  it('stops at V', () => {
    let entries: PlanDraftEntry[] = [];
    for (let i = 0; i < 7; i += 1) entries = raiseSkill(entries, GUNNERY, SKILLS);

    expect(entries).toHaveLength(5);
    expect(planLevel(entries, GUNNERY)).toBe(5);
  });
});

describe('addRequirements', () => {
  it('expands a requirement to every level it needs, prerequisites ahead of it', () => {
    const entries = addRequirements([], [{ skillTypeId: MEDIUM_HYBRID, level: 2 }], SKILLS);

    expect(names(entries)).toEqual([
      'Gunnery 1',
      'Small Hybrid Turret 1',
      'Small Hybrid Turret 2',
      'Small Hybrid Turret 3',
      'Medium Hybrid Turret 1',
      'Medium Hybrid Turret 2',
    ]);
  });

  it('only tops up the levels a draft is missing', () => {
    const started = raiseSkill(raiseSkill([], GUNNERY, SKILLS), GUNNERY, SKILLS);

    const entries = addRequirements(started, [{ skillTypeId: GUNNERY, level: 4 }], SKILLS);

    expect(names(entries)).toEqual(['Gunnery 1', 'Gunnery 2', 'Gunnery 3', 'Gunnery 4']);
  });

  it('merges a fit\'s requirements into an existing draft', () => {
    const entries = addRequirements(
      [],
      [
        { skillTypeId: GALLENTE_FRIGATE, level: 2 },
        { skillTypeId: SMALL_HYBRID, level: 1 },
      ],
      SKILLS,
    );

    expect(names(entries)).toEqual([
      'Spaceship Command 1',
      'Gallente Frigate 1',
      'Gallente Frigate 2',
      'Gunnery 1',
      'Small Hybrid Turret 1',
    ]);
  });

  it('adds a skill with no data as a bare row rather than dropping it', () => {
    const entries = addRequirements([], [{ skillTypeId: 999, level: 2 }], SKILLS);

    expect(entries).toEqual([
      { skillTypeId: 999, skillName: 'Skill 999', level: 1 },
      { skillTypeId: 999, skillName: 'Skill 999', level: 2 },
    ]);
  });
});

describe('lowerSkill / removeFromLevel', () => {
  const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 3 }], SKILLS);

  it('takes the top level off', () => {
    expect(names(lowerSkill(entries, GUNNERY))).toEqual(['Gunnery 1', 'Gunnery 2']);
  });

  it('removes a level and everything above it, never leaving a gap', () => {
    expect(names(removeFromLevel(entries, GUNNERY, 2))).toEqual(['Gunnery 1']);
  });

  it('removes the skill entirely from level I', () => {
    expect(removeFromLevel(entries, GUNNERY, 1)).toEqual([]);
  });

  it('leaves a draft alone when the skill is not in it', () => {
    expect(lowerSkill(entries, MEDIUM_HYBRID)).toHaveLength(3);
  });

  it('removes an unrecognised row by key', () => {
    const unknown: PlanDraftEntry[] = [{ skillTypeId: null, skillName: 'Retired', level: 2 }];

    expect(removeEntry(unknown, entryKey(unknown[0]!))).toEqual([]);
  });
});

describe('expandLevels', () => {
  it('expands a compact plan into a row per level, in place', () => {
    const written: PlanDraftEntry[] = [
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 3 },
      { skillTypeId: SMALL_HYBRID, skillName: 'Small Hybrid Turret', level: 2 },
    ];

    expect(names(expandLevels(written))).toEqual([
      'Gunnery 1',
      'Gunnery 2',
      'Gunnery 3',
      'Small Hybrid Turret 1',
      'Small Hybrid Turret 2',
    ]);
  });

  it('leaves an already-expanded plan untouched and drops exact repeats', () => {
    const written: PlanDraftEntry[] = [
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
    ];

    expect(names(expandLevels(written))).toEqual(['Gunnery 1', 'Gunnery 2']);
  });

  it('passes rows with no known skill through as written', () => {
    const written: PlanDraftEntry[] = [{ skillTypeId: null, skillName: 'Retired', level: 4 }];

    expect(expandLevels(written)).toEqual(written);
  });
});

describe('moveEntry', () => {
  const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 3 }], SKILLS);

  it('moves a row to a later index', () => {
    expect(names(moveEntry(entries, 0, 2))).toEqual(['Gunnery 2', 'Gunnery 3', 'Gunnery 1']);
  });

  it('moves a row to an earlier index', () => {
    expect(names(moveEntry(entries, 2, 0))).toEqual(['Gunnery 3', 'Gunnery 1', 'Gunnery 2']);
  });

  it('copies the list unchanged for a no-op or out-of-range move', () => {
    expect(names(moveEntry(entries, 1, 1))).toEqual(names(entries));
    expect(names(moveEntry(entries, 9, 0))).toEqual(names(entries));
  });
});

describe('dropEntry', () => {
  const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 4 }], SKILLS);
  const REMAP: NeuralAttributes = { ...BALANCED_ATTRIBUTES, perception: 27, charisma: 12 };

  it('lands in front of the target row, wherever the row came from', () => {
    // Index counts rows as they are before the drag, so "in front of row 3" from row 0
    // puts it third.
    expect(names(dropEntry(entries, 0, { index: 3, underRemap: false }))).toEqual([
      'Gunnery 2',
      'Gunnery 3',
      'Gunnery 1',
      'Gunnery 4',
    ]);
    expect(names(dropEntry(entries, 3, { index: 1, underRemap: false }))).toEqual([
      'Gunnery 1',
      'Gunnery 4',
      'Gunnery 2',
      'Gunnery 3',
    ]);
  });

  it('drops at the very end', () => {
    expect(names(dropEntry(entries, 0, { index: 4, underRemap: false }))).toEqual([
      'Gunnery 2',
      'Gunnery 3',
      'Gunnery 4',
      'Gunnery 1',
    ]);
  });

  it('keeps every row object when the drop goes back where it came from', () => {
    const same = dropEntry(entries, 1, { index: 2, underRemap: false });
    expect(same.every((entry, i) => entry === entries[i])).toBe(true);
  });

  it('above a remap trains before it; under it, takes the remap over', () => {
    const withRemap = setRemap(entries, entryKey(entries[2]!), REMAP);

    const above = dropEntry(withRemap, 0, { index: 2, underRemap: false });
    expect(names(above)).toEqual(['Gunnery 2', 'Gunnery 1', 'Gunnery 3', 'Gunnery 4']);
    expect(above[2]!.remapBefore).toBe(REMAP);

    const under = dropEntry(withRemap, 0, { index: 2, underRemap: true });
    expect(names(under)).toEqual(['Gunnery 2', 'Gunnery 1', 'Gunnery 3', 'Gunnery 4']);
    expect(under[1]!.remapBefore).toBe(REMAP);
    expect(under[2]!.remapBefore).toBeUndefined();
    expect(remapCount(under)).toBe(1);
  });

  it('lets a dragged row keep its own remap when dropped under another', () => {
    const own: NeuralAttributes = { ...BALANCED_ATTRIBUTES, memory: 27, charisma: 12 };
    const both = setRemap(
      setRemap(entries, entryKey(entries[2]!), REMAP),
      entryKey(entries[0]!),
      own,
    );

    const dropped = dropEntry(both, 0, { index: 2, underRemap: true });
    expect(dropped[1]!.remapBefore).toBe(own);
    expect(dropped[2]!.remapBefore).toBe(REMAP);
  });
});

describe('sortByPrereqs', () => {
  it('puts prerequisites ahead of the skills that need them', () => {
    const scrambled: PlanDraftEntry[] = [
      { skillTypeId: SMALL_HYBRID, skillName: 'Small Hybrid Turret', level: 1 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
    ];

    expect(names(sortByPrereqs(scrambled, SKILLS))).toEqual([
      'Gunnery 1',
      'Small Hybrid Turret 1',
    ]);
  });

  it('trains a lower level of a skill before a higher one', () => {
    const scrambled: PlanDraftEntry[] = [
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 3 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
    ];

    expect(names(sortByPrereqs(scrambled, SKILLS))).toEqual([
      'Gunnery 1',
      'Gunnery 2',
      'Gunnery 3',
    ]);
  });

  it('leaves an order that already trains untouched', () => {
    const entries = addRequirements([], [{ skillTypeId: MEDIUM_HYBRID, level: 1 }], SKILLS);

    expect(names(sortByPrereqs(entries, SKILLS))).toEqual(names(entries));
  });

  it('keeps every row when a prerequisite is not in the plan at all', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: MEDIUM_HYBRID, skillName: 'Medium Hybrid Turret', level: 1 },
      { skillTypeId: null, skillName: 'Something Retired', level: 1 },
    ];

    expect(sortByPrereqs(entries, SKILLS)).toHaveLength(2);
  });
});

describe('draftIssues', () => {
  it('flags a row queued before a prerequisite it needs', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: SMALL_HYBRID, skillName: 'Small Hybrid Turret', level: 1 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
    ];

    const issue = draftIssues(entries, SKILLS).get(entryKey(entries[0]!));

    expect(issue?.kind).toBe('order');
    expect(issue?.message).toContain('Gunnery I');
  });

  it('flags a level queued before the level below it', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
    ];

    expect(draftIssues(entries, SKILLS).get(entryKey(entries[0]!))?.kind).toBe('order');
  });

  it('notes a prerequisite the plan never trains without calling it an error', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: SMALL_HYBRID, skillName: 'Small Hybrid Turret', level: 1 },
    ];

    expect(draftIssues(entries, SKILLS).get(entryKey(entries[0]!))?.kind).toBe('missing-prereq');
  });

  it('marks a row whose name matched no skill', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: null, skillName: 'Something Retired', level: 2 },
    ];

    expect(draftIssues(entries, SKILLS).get(entryKey(entries[0]!))?.kind).toBe('unknown-skill');
  });

  it('reports nothing for a well-ordered, self-contained plan', () => {
    const entries = addRequirements([], [{ skillTypeId: MEDIUM_HYBRID, level: 2 }], SKILLS);

    expect(draftIssues(entries, SKILLS).size).toBe(0);
  });
});

describe('entrySpCosts and draftTotals', () => {
  it('charges each row only the step it adds', () => {
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 3 }], SKILLS);

    expect(entrySpCosts(entries, SKILLS)).toEqual([
      spForLevel(1, 1),
      spForLevel(1, 2) - spForLevel(1, 1),
      spForLevel(1, 3) - spForLevel(1, 2),
    ]);
    // A queue walking I→III costs exactly what holding III costs.
    expect(draftTotals(entries, SKILLS, BALANCED_ATTRIBUTES).sp).toBe(spForLevel(1, 3));
  });

  it('counts rows with no skill data as unknown rather than free', () => {
    const entries: PlanDraftEntry[] = [
      { skillTypeId: null, skillName: 'Something Retired', level: 2 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1 },
    ];

    expect(draftTotals(entries, SKILLS, BALANCED_ATTRIBUTES)).toMatchObject({
      sp: spForLevel(1, 1),
      unknown: 1,
    });
  });
});

describe('entryTimeCosts', () => {
  it('prices each row at its own skill\'s attributes', () => {
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 1 }], SKILLS);

    const rate = spPerMinute(BALANCED_ATTRIBUTES, { primary: 'perception', secondary: 'willpower' });

    expect(entryTimeCosts(entries, SKILLS, BALANCED_ATTRIBUTES)).toEqual([spForLevel(1, 1) / rate]);
  });

  it('trains faster at higher attributes', () => {
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 5 }], SKILLS);
    const balanced = draftTotals(entries, SKILLS, BALANCED_ATTRIBUTES).minutes;
    const remapped = draftTotals(
      entries,
      SKILLS,
      { ...BALANCED_ATTRIBUTES, perception: 27, willpower: 21 },
      ).minutes;

    expect(remapped).toBeLessThan(balanced);
  });

  it('gives no time for a row whose skill has no attribute data', () => {
    const noAttrs = mergeSkills(SKILLS, [
      { ...CATALOG[0]!, primaryAttribute: null, secondaryAttribute: null },
    ]);
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 1 }], noAttrs);

    expect(entryTimeCosts(entries, noAttrs, BALANCED_ATTRIBUTES)).toEqual([null]);
  });
});

describe('optimizeAttributes', () => {
  /** Every legal arrangement of the same points, for checking the optimum by brute force. */
  function legalArrangements(total: number): NeuralAttributes[] {
    const out: NeuralAttributes[] = [];
    for (let int = 17; int <= 27; int += 1) {
      for (let mem = 17; mem <= 27; mem += 1) {
        for (let per = 17; per <= 27; per += 1) {
          for (let wil = 17; wil <= 27; wil += 1) {
            const cha = total - int - mem - per - wil;
            if (cha < 17 || cha > 27) continue;
            out.push({ intelligence: int, memory: mem, perception: per, willpower: wil, charisma: cha });
          }
        }
      }
    }
    return out;
  }

  it('finds the arrangement no other legal one beats', () => {
    // Gunnery is Per/Wil; Gallente Frigate is Int/Mem — a plan that pulls both ways.
    const entries = addRequirements(
      [],
      [
        { skillTypeId: GUNNERY, level: 5 },
        { skillTypeId: GALLENTE_FRIGATE, level: 4 },
      ],
      SKILLS,
    );

    const optimized = optimizeAttributes(entries, SKILLS, BALANCED_ATTRIBUTES);
    const best = draftTotals(entries, SKILLS, optimized).minutes;

    for (const candidate of legalArrangements(99)) {
      expect(best).toBeLessThanOrEqual(draftTotals(entries, SKILLS, candidate).minutes + 1e-9);
    }
  });

  it('spends the points on the attributes the plan actually trains', () => {
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 5 }], SKILLS);

    const optimized = optimizeAttributes(entries, SKILLS, BALANCED_ATTRIBUTES);

    // All Per/Wil: perception is worth twice what willpower is, so it maxes first.
    expect(optimized.perception).toBe(27);
    expect(optimized.willpower).toBe(21);
    expect(optimized.charisma).toBe(17);
  });

  it('keeps the total it was given, implants included', () => {
    const withImplants: NeuralAttributes = {
      charisma: 24,
      intelligence: 25,
      memory: 25,
      perception: 25,
      willpower: 25,
    };
    const entries = addRequirements([], [{ skillTypeId: GUNNERY, level: 5 }], SKILLS);

    const optimized = optimizeAttributes(entries, SKILLS, withImplants);
    const total = (a: NeuralAttributes): number =>
      a.charisma + a.intelligence + a.memory + a.perception + a.willpower;

    expect(total(optimized)).toBe(total(withImplants));
    // The remap window travels with the implants rather than widening.
    const values = Object.values(optimized) as number[];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(10);
    expect(optimized.perception).toBe(32);
  });

  it('never makes a plan slower than it already is', () => {
    const entries = addRequirements([], [{ skillTypeId: MEDIUM_HYBRID, level: 3 }], SKILLS);
    const current: NeuralAttributes = {
      charisma: 27,
      intelligence: 17,
      memory: 17,
      perception: 21,
      willpower: 17,
    };

    const optimized = optimizeAttributes(entries, SKILLS, current);

    expect(draftTotals(entries, SKILLS, optimized).minutes).toBeLessThan(
      draftTotals(entries, SKILLS, current).minutes,
    );
  });

  it('leaves attributes alone when there is nothing to price', () => {
    expect(optimizeAttributes([], SKILLS, BALANCED_ATTRIBUTES)).toBe(BALANCED_ATTRIBUTES);
  });
});

describe('groupSkills', () => {
  const groups = groupSkills(CATALOG);

  it('buckets skills by SDE group, alphabetically', () => {
    expect(groups.map((g) => g.name)).toEqual(['Gunnery', 'Spaceship Command']);
    expect(groups[0]!.skills.map((s) => s.name)).toEqual([
      'Gunnery',
      'Medium Hybrid Turret',
      'Small Hybrid Turret',
    ]);
  });

  it('carries the attribute pair most of a group trains against', () => {
    expect(groups[1]).toMatchObject({
      name: 'Spaceship Command',
      primaryAttribute: 'perception',
      secondaryAttribute: 'willpower',
    });
  });

  it('marks only the skills that break their group standard', () => {
    const ships = groups[1]!;
    const byName = new Map(ships.skills.map((s) => [s.name, s]));

    expect(breaksGroupStandard(ships, byName.get('Caldari Frigate')!)).toBe(false);
    expect(breaksGroupStandard(ships, byName.get('Spaceship Command')!)).toBe(false);
    expect(breaksGroupStandard(ships, byName.get('Gallente Frigate')!)).toBe(true);
  });

  it('leaves retired skills out of the browser', () => {
    const withRetired = groupSkills([
      ...CATALOG,
      { ...CATALOG[0]!, skillTypeId: 999, name: 'Retired Skill', published: false },
    ]);

    expect(withRetired[0]!.skills.map((s) => s.name)).not.toContain('Retired Skill');
  });
});

describe('filterGroups', () => {
  const groups = groupSkills(CATALOG);

  it('returns everything for an empty query', () => {
    expect(filterGroups(groups, '  ')).toHaveLength(groups.length);
  });

  it('keeps only the skills that match', () => {
    const hits = filterGroups(groups, 'hybrid');

    expect(hits).toHaveLength(1);
    expect(hits[0]!.skills.map((s) => s.name)).toEqual([
      'Medium Hybrid Turret',
      'Small Hybrid Turret',
    ]);
  });

  it('keeps a whole group when the group name matches', () => {
    const hits = filterGroups(groups, 'spaceship');

    expect(hits[0]!.skills).toHaveLength(3);
  });
});

describe('draftText', () => {
  it('writes the lines EVE and MCO both import', () => {
    const entries = addRequirements([], [{ skillTypeId: SMALL_HYBRID, level: 2 }], SKILLS);

    expect(draftText(entries)).toBe(
      'Gunnery I\nSmall Hybrid Turret I\nSmall Hybrid Turret II',
    );
  });
});

describe('remap points', () => {
  const PER_WIL: NeuralAttributes = {
    charisma: 17,
    intelligence: 17,
    memory: 17,
    perception: 27,
    willpower: 21,
  };
  const INT_MEM: NeuralAttributes = {
    charisma: 17,
    intelligence: 27,
    memory: 21,
    perception: 17,
    willpower: 17,
  };

  /** Gunnery I–V (Per/Wil), then Spaceship Command I and Gallente Frigate I–IV (Int/Mem). */
  function mixedPlan(): PlanDraftEntry[] {
    return addRequirements(
      [],
      [
        { skillTypeId: GUNNERY, level: 5 },
        { skillTypeId: GALLENTE_FRIGATE, level: 4 },
      ],
      SKILLS,
    );
  }

  /** Index of the first Gallente Frigate row. */
  function frigateStart(entries: readonly PlanDraftEntry[]): number {
    return entries.findIndex((entry) => entry.skillTypeId === GALLENTE_FRIGATE);
  }

  it('prices rows after a remap at the remap, and rows before it at the start', () => {
    const plain = mixedPlan();
    const at = frigateStart(plain);
    const entries = setRemap(plain, entryKey(plain[at]!), INT_MEM);

    const inForce = entryAttributes(entries, PER_WIL);
    expect(inForce[0]).toBe(PER_WIL);
    expect(inForce[at - 1]).toBe(PER_WIL);
    expect(inForce[at]).toBe(INT_MEM);
    expect(inForce[entries.length - 1]).toBe(INT_MEM);

    const rate = spPerMinute(INT_MEM, { primary: 'intelligence', secondary: 'memory' });
    expect(entryTimeCosts(entries, SKILLS, PER_WIL)[at]).toBeCloseTo(spForLevel(2, 1) / rate);
    expect(draftTotals(entries, SKILLS, PER_WIL).minutes).toBeLessThan(
      draftTotals(plain, SKILLS, PER_WIL).minutes,
    );
  });

  it('splits the queue into one stretch per attribute set', () => {
    const plain = mixedPlan();
    const at = frigateStart(plain);
    const entries = setRemap(plain, entryKey(plain[at]!), INT_MEM);

    expect(remapSegments(entries)).toEqual([
      { start: 0, end: at },
      { start: at, end: entries.length },
    ]);
    expect(remapCount(entries)).toBe(1);
    expect(remapCount(setRemap(entries, entryKey(entries[at]!), null))).toBe(0);
  });

  it('optimises each stretch for the skills it trains', () => {
    const plain = mixedPlan();
    const at = frigateStart(plain);
    const entries = setRemap(plain, entryKey(plain[at]!), BALANCED_ATTRIBUTES);

    const optimized = optimizeAllAttributes(entries, SKILLS, BALANCED_ATTRIBUTES);

    // Before the remap: Gunnery and Spaceship Command, all Per/Wil.
    expect(optimized.base.perception).toBe(27);
    expect(optimized.base.willpower).toBe(21);
    // After it: Gallente Frigate alone, Int/Mem.
    expect(optimized.entries[at]!.remapBefore!.intelligence).toBe(27);
    expect(optimized.entries[at]!.remapBefore!.memory).toBe(21);
  });

  it('costs a level in a later stretch only from where an earlier one left it', () => {
    const plain = addRequirements([], [{ skillTypeId: GUNNERY, level: 5 }], SKILLS);
    // Remap before Gunnery V: its stretch holds one row, which costs IV→V only.
    const entries = setRemap(plain, entryKey(plain[4]!), BALANCED_ATTRIBUTES);
    const optimized = optimizeAttributes(entries, SKILLS, BALANCED_ATTRIBUTES, 4);

    expect(optimized.perception).toBe(27);
    expect(entryTimeCosts(entries, SKILLS, PER_WIL)[4]).toBeCloseTo(
      (spForLevel(1, 5) - spForLevel(1, 4)) /
        spPerMinute(BALANCED_ATTRIBUTES, { primary: 'perception', secondary: 'willpower' }),
    );
  });

  it('travels with its row when the queue is reordered', () => {
    const plain = mixedPlan();
    const at = frigateStart(plain);
    const entries = setRemap(plain, entryKey(plain[at]!), INT_MEM);

    const moved = moveEntry(entries, at, entries.length - 1);
    expect(moved[moved.length - 1]!.remapBefore).toBe(INT_MEM);
    expect(remapCount(moved)).toBe(1);
  });

  it('hands its remap to the next row when its own row is removed', () => {
    const plain = addRequirements([], [{ skillTypeId: GUNNERY, level: 3 }], SKILLS);
    const entries = setRemap(plain, entryKey(plain[1]!), INT_MEM);

    // Removing Gunnery II takes III with it; nothing follows, so the remap goes.
    expect(remapCount(removeFromLevel(entries, GUNNERY, 2))).toBe(0);

    const mixed = mixedPlan();
    const at = frigateStart(mixed);
    const withRemap = setRemap(mixed, entryKey(mixed[at - 1]!), INT_MEM);
    const removed = removeEntry(withRemap, entryKey(withRemap[at - 1]!));
    expect(removed[at - 1]!.remapBefore).toBe(INT_MEM);
  });

  it('keeps a remap where the author put it when a plan is expanded', () => {
    const entries = expandLevels([
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
      { skillTypeId: SMALL_HYBRID, skillName: 'Small Hybrid Turret', level: 3, remapBefore: PER_WIL },
    ]);

    expect(names(entries)).toEqual([
      'Gunnery 1',
      'Gunnery 2',
      'Small Hybrid Turret 1',
      'Small Hybrid Turret 2',
      'Small Hybrid Turret 3',
    ]);
    expect(entries[2]!.remapBefore).toBe(PER_WIL);
    expect(remapCount(entries)).toBe(1);
  });

  it('moves a remap on a duplicate line to the next row that trains something', () => {
    const entries = expandLevels([
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 2 },
      { skillTypeId: GUNNERY, skillName: 'Gunnery', level: 1, remapBefore: PER_WIL },
      { skillTypeId: SPACESHIP_COMMAND, skillName: 'Spaceship Command', level: 1 },
    ]);

    expect(entries.map((entry) => entry.remapBefore)).toEqual([undefined, undefined, PER_WIL]);
  });

  it('is written into saved text but left out of the clipboard copy', () => {
    const plain = addRequirements([], [{ skillTypeId: GUNNERY, level: 2 }], SKILLS);
    const entries = setRemap(plain, entryKey(plain[1]!), PER_WIL);

    expect(draftText(entries)).toBe(
      'Gunnery I\n[Remap] Int 17 Mem 17 Per 27 Wil 21 Cha 17\nGunnery II',
    );
    expect(draftText(entries, { includeRemaps: false })).toBe('Gunnery I\nGunnery II');
  });
});
