import { describe, expect, it } from 'vitest';
import { isNewerBuild, normalizeBuild, parseLatestBuild } from '@main/sde/latest';
import { SDE_LATEST_URL, sdeZipUrl } from '@main/config';

describe('parseLatestBuild', () => {
  it('reads the build CCP publishes', () => {
    expect(
      parseLatestBuild(
        '{"_key": "sde", "buildNumber": 3473160, "releaseDate": "2026-08-19T11:07:27Z"}\n',
      ),
    ).toEqual({ build: '3473160', releasedAt: '2026-08-19T11:07:27Z' });
  });

  it('picks the sde entry rather than the first line', () => {
    // JSON *lines*: CCP may list other datasets in the same catalogue, and
    // taking whatever came first would import one of those build numbers.
    const body = [
      '{"_key": "universe", "buildNumber": 999, "releaseDate": "2026-08-01T00:00:00Z"}',
      '{"_key": "sde", "buildNumber": 3473160, "releaseDate": "2026-08-19T11:07:27Z"}',
    ].join('\n');

    expect(parseLatestBuild(body)?.build).toBe('3473160');
  });

  it('tolerates blank lines and unreadable ones', () => {
    const body = [
      '',
      'not json',
      '{"_key": "sde"}', // no build number: not an answer
      '   {"_key": "sde", "buildNumber": 3473160}   ',
    ].join('\n');

    expect(parseLatestBuild(body)).toEqual({ build: '3473160', releasedAt: null });
  });

  it('reports nothing when the catalogue names no SDE build', () => {
    expect(parseLatestBuild('')).toBeNull();
    expect(parseLatestBuild('{"_key": "universe", "buildNumber": 12}')).toBeNull();
    expect(parseLatestBuild('<html>404</html>')).toBeNull();
    expect(parseLatestBuild('{"_key": "sde", "buildNumber": "latest"}')).toBeNull();
  });
});

describe('normalizeBuild', () => {
  it('accepts a build number in either spelling', () => {
    // The catalogue writes a JSON number; sde_version stores the text.
    expect(normalizeBuild(3473160)).toBe('3473160');
    expect(normalizeBuild('3473160')).toBe('3473160');
    expect(normalizeBuild(' 3473160 ')).toBe('3473160');
  });

  it('rejects anything that is not a whole positive build', () => {
    for (const value of [0, -1, 1.5, '', 'unknown', 'v3', null, undefined, {}]) {
      expect(normalizeBuild(value), String(value)).toBeNull();
    }
  });
});

describe('isNewerBuild', () => {
  it('is true only for a build after the imported one', () => {
    expect(isNewerBuild('3473160', '3351823')).toBe(true);
    expect(isNewerBuild('3351823', '3351823')).toBe(false);
    expect(isNewerBuild('3351823', '3473160')).toBe(false);
  });

  it('orders numerically, not as text', () => {
    expect(isNewerBuild('3473160', '999999')).toBe(true);
    expect(isNewerBuild('999999', '3473160')).toBe(false);
  });

  it('offers nothing when either side is unreadable', () => {
    // Nothing imported yet, or a zip whose _sde.yaml carried no build: the
    // banner already has something to say, and a 100 MB download is not it.
    expect(isNewerBuild('3473160', null)).toBe(false);
    expect(isNewerBuild('3473160', 'unknown')).toBe(false);
    expect(isNewerBuild(null, '3351823')).toBe(false);
  });
});

describe('sdeZipUrl', () => {
  it('names the zip for one build, under the catalogue it came from', () => {
    expect(sdeZipUrl('3473160')).toBe(
      'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3473160-yaml.zip',
    );
    expect(SDE_LATEST_URL).toBe(
      'https://developers.eveonline.com/static-data/tranquility/latest.jsonl',
    );
  });
});
