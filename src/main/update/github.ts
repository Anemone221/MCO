/**
 * Reading GitHub's releases API: turning the repository URL into the API URL,
 * and a response body into the few facts MCO shows. Both pure, so they
 * unit-test without a network — and so a malformed body is rejected here rather
 * than reaching the UI as `undefined`.
 */

export interface ReleaseInfo {
  /** The tag as published, e.g. `v0.2.0`. */
  tag: string;
  /** Release title, when the release was given one. */
  name: string | null;
  /** The human-facing release page; null falls back to the repo's release index. */
  url: string | null;
  /** ISO timestamp, or null on a release GitHub reports as unpublished. */
  publishedAt: string | null;
}

/**
 * `https://github.com/owner/repo` → the API URL of its latest release.
 *
 * `/releases/latest` rather than listing `/releases`: GitHub already excludes
 * drafts and prereleases from it, so tagging a beta never prompts anyone to
 * install one. Returns null for a URL that isn't a GitHub repository, which is
 * a misconfiguration rather than a failed check.
 */
export function latestReleaseApiUrl(repoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;

  const [owner, repo] = parsed.pathname
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (!owner || !repo) return null;
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The fields MCO uses out of a release payload, or null when the body isn't one.
 *
 * Only `tag_name` is required: it is the version the check compares, and a
 * release without one says nothing about whether an update exists.
 */
export function parseRelease(body: unknown): ReleaseInfo | null {
  if (typeof body !== 'object' || body === null) return null;
  const release = body as Record<string, unknown>;

  const tag = stringOrNull(release['tag_name']);
  if (tag === null) return null;

  return {
    tag,
    name: stringOrNull(release['name']),
    url: stringOrNull(release['html_url']),
    publishedAt: stringOrNull(release['published_at']),
  };
}
