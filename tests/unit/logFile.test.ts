import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOG_FILE_NAME, PREVIOUS_LOG_FILE_NAME, RotatingLogFile } from '@main/logFile';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mco-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('RotatingLogFile', () => {
  it('creates its directory and appends lines in order', () => {
    const nested = join(dir, 'logs');
    const log = new RotatingLogFile(nested);

    log.append(['one', 'two']);
    log.append(['three']);

    expect(readFileSync(join(nested, LOG_FILE_NAME), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('picks up where a previous session left off', () => {
    new RotatingLogFile(dir).append(['yesterday']);

    // A new instance is a new run of the app: the whole point of the file.
    const log = new RotatingLogFile(dir);
    log.append(['today']);

    expect(log.readAll()).toBe('yesterday\ntoday\n');
  });

  it('rotates once the cap would be passed, keeping one previous file', () => {
    const log = new RotatingLogFile(dir, { maxBytes: 20 });

    log.append(['aaaaaaaaaaaaaaa']); // 16 bytes
    log.append(['bbbbbbbbbbbbbbb']); // would be 32: rotates first
    expect(readFileSync(join(dir, PREVIOUS_LOG_FILE_NAME), 'utf8')).toBe('aaaaaaaaaaaaaaa\n');
    expect(readFileSync(join(dir, LOG_FILE_NAME), 'utf8')).toBe('bbbbbbbbbbbbbbb\n');

    log.append(['ccccccccccccccc']); // rotates again; the "a" file is replaced
    expect(log.readAll()).toBe('bbbbbbbbbbbbbbb\nccccccccccccccc\n');
  });

  it('counts the size left by a previous session towards the cap', () => {
    new RotatingLogFile(dir, { maxBytes: 20 }).append(['aaaaaaaaaaaaaaa']);

    new RotatingLogFile(dir, { maxBytes: 20 }).append(['bbbbbbbbbbbbbbb']);

    expect(existsSync(join(dir, PREVIOUS_LOG_FILE_NAME))).toBe(true);
  });

  it('writes a batch larger than the cap rather than dropping it', () => {
    const log = new RotatingLogFile(dir, { maxBytes: 4 });

    log.append(['much longer than four bytes']);

    // Nothing to rotate away from an empty file, and the lines must land.
    expect(existsSync(join(dir, PREVIOUS_LOG_FILE_NAME))).toBe(false);
    expect(log.readAll()).toBe('much longer than four bytes\n');
  });

  it('reads as empty before anything is written', () => {
    expect(new RotatingLogFile(dir).readAll()).toBe('');
  });
});
