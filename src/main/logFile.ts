import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The on-disk half of the log: two size-capped files in the profile folder.
 *
 * `mco.log` is appended to; once it would pass `maxBytes` it is renamed to
 * `mco.log.1` (replacing the previous one) and a fresh file is started. Two
 * files of 2 MB hold days of ordinary running, which is the point — the
 * in-memory buffer in `log.ts` dies with the process, so a sweep that failed
 * overnight in tray mode, or logins that expired yesterday, were gone by the
 * time anyone looked.
 *
 * Kept free of Electron so it unit-tests against a temp directory.
 */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export const LOG_FILE_NAME = 'mco.log';
export const PREVIOUS_LOG_FILE_NAME = 'mco.log.1';

export class RotatingLogFile {
  private readonly current: string;
  private readonly previous: string;
  private readonly maxBytes: number;
  /** Size of `current` on disk, tracked so a write never needs a stat. */
  private size: number;

  constructor(dir: string, options: { maxBytes?: number } = {}) {
    mkdirSync(dir, { recursive: true });
    this.current = join(dir, LOG_FILE_NAME);
    this.previous = join(dir, PREVIOUS_LOG_FILE_NAME);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.size = fileSize(this.current);
  }

  /** Append lines, rotating first when they would push the file past its cap. */
  append(lines: string[]): void {
    if (lines.length === 0) return;
    const text = lines.join('\n') + '\n';
    const bytes = Buffer.byteLength(text, 'utf8');
    // An empty file is never rotated: one batch larger than the cap still has
    // to land somewhere, and rotating would only discard the previous file.
    if (this.size > 0 && this.size + bytes > this.maxBytes) {
      renameSync(this.current, this.previous);
      this.size = 0;
    }
    appendFileSync(this.current, text, 'utf8');
    this.size += bytes;
  }

  /** Everything on disk, oldest first: the rotated file, then the current one. */
  readAll(): string {
    return readIfPresent(this.previous) + readIfPresent(this.current);
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
