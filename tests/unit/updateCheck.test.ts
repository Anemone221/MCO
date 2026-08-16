import { describe, expect, it } from 'vitest';
import { latestReleaseApiUrl, parseRelease } from '@main/update/github';
import { compareVersions, isNewerVersion, parseVersion } from '@main/update/version';

describe('parseVersion', () => {
  it('reads both spellings of a version', () => {
    expect(parseVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: [] });
    // Release tags carry the v; package.json does not.
    expect(parseVersion('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: [] });
    expect(parseVersion('  v1.10.3  ')).toEqual({
      major: 1,
      minor: 10,
      patch: 3,
      prerelease: [],
    });
  });

  it('defaults an omitted patch and drops build metadata', () => {
    expect(parseVersion('1.2')?.patch).toBe(0);
    expect(parseVersion('1.2.3+20260816')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it('keeps numeric prerelease identifiers numeric', () => {
    expect(parseVersion('0.2.0-rc.2')?.prerelease).toEqual(['rc', 2]);
    expect(parseVersion('0.2.0-beta')?.prerelease).toEqual(['beta']);
  });

  it('rejects anything that is not a version', () => {
    for (const text of ['', 'latest', 'v', '1', 'nightly-2026-08-16', '1.2.3.4', 'v1.x']) {
      expect(parseVersion(text), text).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  /** Compare two version strings, both of which must parse. */
  function cmp(a: string, b: string): number {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (left === null || right === null) throw new Error(`unparseable: ${a} / ${b}`);
    return compareVersions(left, right);
  }

  it('orders by major, then minor, then patch', () => {
    expect(cmp('1.0.0', '0.9.9')).toBe(1);
    expect(cmp('0.2.0', '0.10.0')).toBe(-1); // not string order
    expect(cmp('0.1.9', '0.1.10')).toBe(-1);
    expect(cmp('v0.1.0', '0.1.0')).toBe(0);
  });

  it('ranks a prerelease below its own final release', () => {
    expect(cmp('0.2.0-rc.1', '0.2.0')).toBe(-1);
    expect(cmp('0.2.0', '0.2.0-rc.1')).toBe(1);
    expect(cmp('0.2.0-rc.1', '0.1.9')).toBe(1);
  });

  it('orders prerelease identifiers by semver precedence', () => {
    expect(cmp('0.2.0-rc.2', '0.2.0-rc.10')).toBe(-1); // numeric, not lexical
    expect(cmp('0.2.0-alpha', '0.2.0-beta')).toBe(-1);
    expect(cmp('0.2.0-rc', '0.2.0-rc.1')).toBe(-1); // fewer identifiers rank lower
    expect(cmp('0.2.0-1', '0.2.0-alpha')).toBe(-1); // numeric ranks below alphanumeric
    expect(cmp('0.2.0-rc.1', '0.2.0-rc.1')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('is true only for a genuinely later release', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('v0.1.0', '0.2.0')).toBe(false);
  });

  it('does not offer an update when either side is unreadable', () => {
    // A tag that isn't a version is not an update, and an unreadable local
    // version is no reason to prompt a reinstall.
    expect(isNewerVersion('nightly', '0.1.0')).toBe(false);
    expect(isNewerVersion('v9.0.0', 'unknown')).toBe(false);
  });
});

describe('latestReleaseApiUrl', () => {
  it('derives the API URL from the repository URL', () => {
    expect(latestReleaseApiUrl('https://github.com/Anemone221/MCO')).toBe(
      'https://api.github.com/repos/Anemone221/MCO/releases/latest',
    );
    expect(latestReleaseApiUrl('https://github.com/Anemone221/MCO.git')).toBe(
      'https://api.github.com/repos/Anemone221/MCO/releases/latest',
    );
  });

  it('refuses anything that is not a GitHub repository', () => {
    for (const url of [
      'https://gitlab.com/owner/repo',
      'https://github.com/Anemone221',
      'not a url',
      '',
    ]) {
      expect(latestReleaseApiUrl(url), url).toBeNull();
    }
  });
});

describe('parseRelease', () => {
  it('reads the fields the check uses', () => {
    expect(
      parseRelease({
        tag_name: 'v0.2.0',
        name: 'Skill plan overhaul',
        html_url: 'https://github.com/Anemone221/MCO/releases/tag/v0.2.0',
        published_at: '2026-08-16T10:00:00Z',
        // Fields MCO does not use are ignored rather than tripping the parse.
        assets: [{ name: 'MCO-Setup-0.2.0.exe' }],
      }),
    ).toEqual({
      tag: 'v0.2.0',
      name: 'Skill plan overhaul',
      url: 'https://github.com/Anemone221/MCO/releases/tag/v0.2.0',
      publishedAt: '2026-08-16T10:00:00Z',
    });
  });

  it('tolerates a release with no title or page', () => {
    expect(parseRelease({ tag_name: 'v0.2.0', name: null })).toEqual({
      tag: 'v0.2.0',
      name: null,
      url: null,
      publishedAt: null,
    });
  });

  it('rejects a body with no tag to compare', () => {
    expect(parseRelease({ name: 'no tag' })).toBeNull();
    expect(parseRelease({ tag_name: '' })).toBeNull();
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('v0.2.0')).toBeNull();
  });
});
