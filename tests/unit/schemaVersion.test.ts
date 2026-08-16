import { describe, expect, it } from 'vitest';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  schemaDowngradeMessage,
} from '@main/db/migrations';

describe('schemaDowngradeMessage', () => {
  it('accepts a profile this build can read', () => {
    expect(schemaDowngradeMessage(24, 24)).toBeNull(); // up to date
    expect(schemaDowngradeMessage(20, 24)).toBeNull(); // has migrations pending
    expect(schemaDowngradeMessage(0, 24)).toBeNull(); // fresh profile
  });

  it('refuses a profile written by a newer build', () => {
    const message = schemaDowngradeMessage(25, 24);

    expect(message).not.toBeNull();
    // Both numbers belong in the text — this is what a user quotes in a report.
    expect(message).toContain('v25');
    expect(message).toContain('v24');
    // And it has to say what to do about it, not just what went wrong.
    expect(message).toContain('mco.sqlite');
  });
});

describe('MIGRATIONS', () => {
  it('is in ascending version order', () => {
    // LATEST_SCHEMA_VERSION takes the last element rather than the max, so an
    // out-of-order insert would silently understate the schema — and the
    // downgrade guard would then wave through a profile it cannot read.
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('has no duplicate versions', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('reports the highest version as LATEST_SCHEMA_VERSION', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
  });
});
