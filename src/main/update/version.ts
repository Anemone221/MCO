/**
 * Semantic-version comparison, for deciding whether a published GitHub release
 * is newer than the running build. Pure so it unit-tests without Electron, a
 * database or a network.
 *
 * Both spellings parse: release tags are written `v0.2.0`, `package.json`
 * writes `0.2.0`, and the check compares one against the other.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /**
   * Dot-separated prerelease identifiers (`0.2.0-rc.2` → `['rc', 2]`); empty
   * for a final release. Numeric identifiers are kept as numbers because semver
   * orders them numerically rather than as text — `rc.10` follows `rc.9`.
   */
  prerelease: readonly (string | number)[];
}

/** `v?MAJOR.MINOR[.PATCH][-prerelease][+build]`. Build metadata is ignored (semver §10). */
const VERSION_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a version string, or null when it isn't one. */
export function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_RE.exec(text.trim());
  if (!match) return null;

  // Defaults cover the optional groups; the required ones are present whenever
  // the pattern matched at all.
  const [, major = '0', minor = '0', patch = '0', prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease
      ? prerelease.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
      : [],
  };
}

function order(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver §11 precedence for the prerelease field. */
function comparePrerelease(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  // A final release outranks every prerelease of the same core version, so
  // 0.2.0 is an update for someone running 0.2.0-rc.1 but not the reverse.
  if (a.length === 0 || b.length === 0) return order(b.length, a.length);

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    // All preceding identifiers equal: the shorter set has lower precedence.
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNumeric = typeof left === 'number';
    const rightNumeric = typeof right === 'number';
    // Numeric identifiers always rank below alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;

    if (leftNumeric && rightNumeric) {
      const compared = order(left, right);
      if (compared !== 0) return compared;
    } else if (left !== right) {
      return String(left) < String(right) ? -1 : 1;
    }
  }
  return 0;
}

/** Standard -1 / 0 / 1 ordering of two parsed versions. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return (
    order(a.major, b.major) ||
    order(a.minor, b.minor) ||
    order(a.patch, b.patch) ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

/**
 * Whether `candidate` is a release the running build should be told about.
 *
 * Unparseable input answers false in both directions: a tag that isn't a
 * version is not an update, and an unreadable local version is no reason to
 * prompt someone to reinstall.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const running = parseVersion(current);
  if (next === null || running === null) return false;
  return compareVersions(next, running) > 0;
}
