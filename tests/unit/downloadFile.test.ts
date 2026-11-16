import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile } from '@main/sde/downloadFile';

let dir: string;
let dest: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mco-dl-'));
  dest = join(dir, 'cache', 'sde.zip');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A `fetch` that answers with the given chunks and headers. */
function fetchReturning(
  chunks: string[],
  headers: Record<string, string> = {},
  status = 200,
): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status, headers },
    );
}

/**
 * A `fetch` whose body delivers one chunk and then goes silent until aborted —
 * what a stalled CDN connection looks like from here.
 */
function fetchThatStalls(firstChunk: string | null): typeof fetch {
  return async (_url, init) => {
    const signal = init?.signal;
    if (firstChunk === null) {
      // Stalls before the response headers ever arrive.
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(firstChunk));
          signal?.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError')),
          );
        },
      }),
      { status: 200 },
    );
  };
}

describe('downloadFile', () => {
  it('writes the body to the destination and reports progress', async () => {
    const progress: number[] = [];

    await downloadFile('https://example.invalid/sde.zip', dest, {
      fetchImpl: fetchReturning(['hello ', 'world'], { 'content-length': '11' }),
      onProgress: (p) => progress.push(p.receivedBytes),
    });

    expect(readFileSync(dest, 'utf8')).toBe('hello world');
    expect(progress).toEqual([6, 11]);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('accepts a response with no Content-Length', async () => {
    await downloadFile('https://example.invalid/sde.zip', dest, {
      fetchImpl: fetchReturning(['abc']),
    });

    expect(readFileSync(dest, 'utf8')).toBe('abc');
  });

  it('rejects a body shorter than Content-Length and keeps the previous file', async () => {
    await downloadFile('https://example.invalid/sde.zip', dest, {
      fetchImpl: fetchReturning(['previous build']),
    });

    await expect(
      downloadFile('https://example.invalid/sde.zip', dest, {
        fetchImpl: fetchReturning(['cut'], { 'content-length': '1000' }),
      }),
    ).rejects.toThrow(/cut short \(3 of 1000 bytes\)/);

    // The good zip from before is untouched, and no partial file is left.
    expect(readFileSync(dest, 'utf8')).toBe('previous build');
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('does not length-check an encoded body', async () => {
    // fetch hands over decoded bytes; the header counts the encoded ones.
    await downloadFile('https://example.invalid/sde.zip', dest, {
      fetchImpl: fetchReturning(['decoded'], {
        'content-length': '3',
        'content-encoding': 'gzip',
      }),
    });

    expect(readFileSync(dest, 'utf8')).toBe('decoded');
  });

  it('reports an HTTP failure without writing anything', async () => {
    await expect(
      downloadFile('https://example.invalid/sde.zip', dest, {
        fetchImpl: fetchReturning(['nope'], {}, 404),
      }),
    ).rejects.toThrow('SDE download failed: HTTP 404');

    expect(existsSync(dest)).toBe(false);
  });

  it('gives up on a body that stops delivering bytes', async () => {
    writeFileSync(join(dir, 'marker'), ''); // dir exists; dest's folder is made by the call

    await expect(
      downloadFile('https://example.invalid/sde.zip', dest, {
        fetchImpl: fetchThatStalls('first chunk'),
        stallTimeoutMs: 40,
      }),
    ).rejects.toThrow(/stalled/);

    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('gives up on a connection that never answers', async () => {
    await expect(
      downloadFile('https://example.invalid/sde.zip', dest, {
        fetchImpl: fetchThatStalls(null),
        stallTimeoutMs: 40,
      }),
    ).rejects.toThrow(/stalled/);
  });
});
