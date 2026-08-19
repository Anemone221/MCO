import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  parseBlueprints,
  parseNamedFile,
  parseSolarSystems,
  parseStargates,
  parseTypeDogmaStream,
  parseTypesStream,
  parseYamlScalar,
} from '@main/sde/parse';

describe('parseYamlScalar', () => {
  it('returns plain scalars unchanged', () => {
    expect(parseYamlScalar(' Solar System ')).toBe('Solar System');
  });

  it('unwraps single-quoted scalars and unescapes doubled quotes', () => {
    expect(parseYamlScalar("'#System'")).toBe('#System');
    expect(parseYamlScalar("'It''s a trap'")).toBe("It's a trap");
  });

  it('unwraps double-quoted scalars', () => {
    expect(parseYamlScalar('"Quoted Name"')).toBe('Quoted Name');
  });
});

describe('parseNamedFile', () => {
  it('parses an id-keyed YAML file into named entries', () => {
    const yaml = [
      '6:',
      '  name:',
      '    en: Sun',
      '  published: true',
      '7:',
      '  categoryID: 2',
      '  name:',
      '    en: Planet',
      '  published: false',
    ].join('\n');

    const entries = parseNamedFile(yaml);
    expect(entries).toContainEqual({ id: 6, name: 'Sun', published: 1, categoryId: undefined });
    expect(entries).toContainEqual({ id: 7, name: 'Planet', published: 0, categoryId: 2 });
  });
});

describe('parseTypesStream', () => {
  it('extracts id, groupId, name and published from a types stream', async () => {
    const yaml = [
      '587:',
      '  groupID: 25',
      '  name:',
      '    de: Rifter',
      '    en: Rifter',
      '  published: true',
      '34:',
      '  groupID: 18',
      '  name:',
      '    en: Tritanium',
      '  published: true',
      '',
    ].join('\n');

    const rows = await parseTypesStream(Readable.from(yaml));
    expect(rows).toEqual([
      { id: 587, groupId: 25, name: 'Rifter', published: 1, marketGroupId: null, metaGroupId: null },
      { id: 34, groupId: 18, name: 'Tritanium', published: 1, marketGroupId: null, metaGroupId: null },
    ]);
  });

  it('extracts market and meta group, which decide what the blueprint checklist counts', async () => {
    const yaml = [
      '11372:',
      '  groupID: 105',
      '  marketGroupID: 1010',
      '  metaGroupID: 2',
      '  name:',
      '    en: Wolf Blueprint',
      '  published: true',
      '',
    ].join('\n');

    const rows = await parseTypesStream(Readable.from(yaml));
    expect(rows[0]).toMatchObject({ marketGroupId: 1010, metaGroupId: 2 });
  });

  it('skips entries that have no english name', async () => {
    const yaml = ['99:', '  groupID: 5', '  name:', '    de: KeinEnglisch', '  published: false', ''].join(
      '\n',
    );
    const rows = await parseTypesStream(Readable.from(yaml));
    expect(rows).toEqual([]);
  });
});

describe('parseBlueprints', () => {
  /** Shape lifted from the real blueprints.yaml: a T1 frigate BP that can also be invented from. */
  const RIFTER_BP = [
    '691:',
    '  activities:',
    '    copying:',
    '      time: 4800',
    '    invention:',
    '      materials:',
    '      - quantity: 2',
    '        typeID: 20416',
    '      products:',
    '      - probability: 0.3',
    '        quantity: 1',
    '        typeID: 39581',
    '      time: 63900',
    '    manufacturing:',
    '      materials:',
    '      - quantity: 24000',
    '        typeID: 34',
    '      products:',
    '      - quantity: 1',
    '        typeID: 587',
    '      skills:',
    '      - level: 1',
    '        typeID: 3380',
    '      time: 6000',
    '    research_material:',
    '      time: 2100',
    '  blueprintTypeID: 691',
    '  maxProductionLimit: 30',
  ];

  it('takes the manufacturing product, not the invention product', () => {
    // Invention yields the *Tech II blueprint*; reading it would file every
    // Tech I blueprint under its Tech II descendant.
    expect(parseBlueprints(RIFTER_BP.join('\n'))).toEqual([
      {
        blueprintTypeId: 691,
        productTypeId: 587,
        activity: 'manufacturing',
        maxProductionLimit: 30,
      },
    ]);
  });

  it('takes the reaction product for reaction formulas', () => {
    const yaml = [
      '46166:',
      '  activities:',
      '    copying:',
      '      time: 4800',
      '    reaction:',
      '      materials:',
      '      - quantity: 100',
      '        typeID: 16275',
      '      products:',
      '      - quantity: 200',
      '        typeID: 16679',
      '      time: 10800',
      '  blueprintTypeID: 46166',
    ].join('\n');

    expect(parseBlueprints(yaml)).toEqual([
      {
        blueprintTypeId: 46166,
        productTypeId: 16679,
        activity: 'reaction',
        maxProductionLimit: null,
      },
    ]);
  });

  it('parses every entry in a multi-blueprint file', () => {
    const yaml = [
      ...RIFTER_BP,
      '681:',
      '  activities:',
      '    manufacturing:',
      '      products:',
      '      - quantity: 1',
      '        typeID: 165',
      '      time: 600',
      '  blueprintTypeID: 681',
      '  maxProductionLimit: 300',
      '',
    ].join('\n');

    const rows = parseBlueprints(yaml);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ blueprintTypeId: 681, productTypeId: 165 });
  });

  it('reports no product for a blueprint that builds nothing', () => {
    const yaml = ['1234:', '  activities:', '    copying:', '      time: 1', '  blueprintTypeID: 1234'].join(
      '\n',
    );
    expect(parseBlueprints(yaml)).toEqual([
      { blueprintTypeId: 1234, productTypeId: null, activity: 'other', maxProductionLimit: null },
    ]);
  });
});

describe('parseTypeDogmaStream', () => {
  it('extracts skill requirements and skill ranks from dogma blocks', async () => {
    const yaml = [
      '587:',
      '  dogmaAttributes:',
      '  - attributeID: 182',
      '    value: 3327.0',
      '  - attributeID: 277',
      '    value: 3.0',
      '  - attributeID: 9',
      '    value: 400.0',
      '3327:',
      '  dogmaAttributes:',
      '  - attributeID: 275',
      '    value: 2.0',
      '',
    ].join('\n');

    const { skillReqs, ranks } = await parseTypeDogmaStream(Readable.from(yaml));
    expect(skillReqs).toEqual([{ typeId: 587, skillTypeId: 3327, level: 3 }]);
    expect(ranks).toEqual([{ typeId: 3327, rank: 2 }]);
  });

  it('extracts primary/secondary training attributes from skill blocks', async () => {
    const yaml = [
      '3327:',
      '  dogmaAttributes:',
      '  - attributeID: 275',
      '    value: 2.0',
      '  - attributeID: 180',
      '    value: 164.0',
      '  - attributeID: 181',
      '    value: 165.0',
      '',
    ].join('\n');

    const { skillAttributes } = await parseTypeDogmaStream(Readable.from(yaml));
    expect(skillAttributes).toEqual([
      { typeId: 3327, primaryAttributeId: 164, secondaryAttributeId: 165 },
    ]);
  });

  it('skips blocks missing either training attribute', async () => {
    const yaml = [
      '3327:',
      '  dogmaAttributes:',
      '  - attributeID: 180',
      '    value: 167.0',
      '',
    ].join('\n');

    const { skillAttributes } = await parseTypeDogmaStream(Readable.from(yaml));
    expect(skillAttributes).toEqual([]);
  });
});

describe('parseSolarSystems', () => {
  it('extracts system id, name, region, security and position', () => {
    const yaml = [
      '30000142:',
      '  constellationID: 20000020',
      '  name:',
      '    de: Jita',
      '    en: Jita',
      '  position:',
      '    x: -1.2e+17',
      '    y: 6.1e+16',
      '    z: -1.1e+17',
      '  regionID: 10000002',
      '  securityStatus: 0.9459',
      '30002187:',
      '  name:',
      '    en: Amamake',
      '  regionID: 10000042',
      '  securityStatus: 0.3614',
    ].join('\n');

    expect(parseSolarSystems(yaml)).toEqual([
      {
        id: 30000142,
        name: 'Jita',
        regionId: 10000002,
        security: 0.9459,
        x: -1.2e17,
        y: 6.1e16,
        z: -1.1e17,
      },
      // No position block: the coordinates read as unknown rather than as the
      // centre of New Eden.
      {
        id: 30002187,
        name: 'Amamake',
        regionId: 10000042,
        security: 0.3614,
        x: null,
        y: null,
        z: null,
      },
    ]);
  });
});

describe('parseStargates', () => {
  it('reads each gate as a link from its system to its destination', () => {
    const yaml = [
      '50000001:',
      '  destination:',
      '    solarSystemID: 30000778',
      '    stargateID: 50000482',
      '  position:',
      '    x: 390565601280.0',
      '    y: 41190481920.0',
      '    z: -893183385600.0',
      '  solarSystemID: 30000777',
      '  typeID: 29633',
      '50000482:',
      '  destination:',
      '    solarSystemID: 30000777',
      '    stargateID: 50000001',
      '  solarSystemID: 30000778',
      '  typeID: 29633',
    ].join('\n');

    expect(parseStargates(yaml)).toEqual([
      { fromSystemId: 30000777, toSystemId: 30000778 },
      { fromSystemId: 30000778, toSystemId: 30000777 },
    ]);
  });

  it('drops gates that name neither end', () => {
    const yaml = [
      '50000001:',
      '  solarSystemID: 30000777',
      '50000002:',
      '  destination:',
      '    stargateID: 50000482',
      '  solarSystemID: 30000777',
    ].join('\n');

    expect(parseStargates(yaml)).toEqual([]);
  });
});
