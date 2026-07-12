import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  parseNamedFile,
  parseSolarSystems,
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
      { id: 587, groupId: 25, name: 'Rifter', published: 1 },
      { id: 34, groupId: 18, name: 'Tritanium', published: 1 },
    ]);
  });

  it('skips entries that have no english name', async () => {
    const yaml = ['99:', '  groupID: 5', '  name:', '    de: KeinEnglisch', '  published: false', ''].join(
      '\n',
    );
    const rows = await parseTypesStream(Readable.from(yaml));
    expect(rows).toEqual([]);
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
});

describe('parseSolarSystems', () => {
  it('extracts system id, name, region and security', () => {
    const yaml = [
      '30000142:',
      '  constellationID: 20000020',
      '  name:',
      '    de: Jita',
      '    en: Jita',
      '  regionID: 10000002',
      '  securityStatus: 0.9459',
      '30002187:',
      '  name:',
      '    en: Amamake',
      '  regionID: 10000042',
      '  securityStatus: 0.3614',
    ].join('\n');

    expect(parseSolarSystems(yaml)).toEqual([
      { id: 30000142, name: 'Jita', regionId: 10000002, security: 0.9459 },
      { id: 30002187, name: 'Amamake', regionId: 10000042, security: 0.3614 },
    ]);
  });
});
