import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS, isNotificationKind } from '@shared/notifications';

describe('NOTIFICATION_KINDS', () => {
  it('has no duplicate kinds', () => {
    const kinds = NOTIFICATION_KINDS.map((k) => k.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('recognises its own kinds and nothing else', () => {
    for (const { kind } of NOTIFICATION_KINDS) expect(isNotificationKind(kind)).toBe(true);
    expect(isNotificationKind('made-up')).toBe(false);
  });

  it('lists every kind the services raise', () => {
    // A kind that is raised but not listed still delivers — it just has no
    // switch in Settings, and nothing else would ever point that out.
    const servicesDir = join(import.meta.dirname, '../../src/main/services');
    const raised = new Set<string>();
    for (const file of readdirSync(servicesDir)) {
      const source = readFileSync(join(servicesDir, file), 'utf8');
      for (const match of source.matchAll(/^\s*kind: '([a-z-]+)',$/gm)) raised.add(match[1]!);
    }

    expect(raised.size).toBeGreaterThan(0);
    expect([...raised].filter((kind) => !isNotificationKind(kind))).toEqual([]);
  });
});
