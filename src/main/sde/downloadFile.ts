import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { UserFacingError } from '../errors';

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadOptions {
  headers?: Record<string, string>;
  onProgress?: (progress: DownloadProgress) => void;
  /** Give up when no byte arrives for this long. Covers the connect as well. */
  stallTimeoutMs?: number;
  /** Injected in tests; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
}

/** Long enough for a slow link to keep a ~100 MB download alive, short enough to notice a dead one. */
const DEFAULT_STALL_TIMEOUT_MS = 60_000;

/**
 * Download `url` to `dest`, failing loudly instead of hanging or leaving a
 * short file behind.
 *
 * Three things the plain `fetch`-and-pipe did not do:
 *
 *  - **A stall timeout.** A connection that stops delivering bytes used to hold
 *    the import open for ever, with no way to cancel it. The timer is reset by
 *    every chunk, so it bounds silence, not the size of the download.
 *  - **A length check.** The bytes received are compared with `Content-Length`
 *    when the server sent one, so a connection cut short is an error here
 *    rather than a corrupt zip three steps later.
 *  - **An atomic hand-over.** The body is written to `<dest>.part` and renamed
 *    only once complete; `dest` is either the previous good file or the new
 *    one, never half of each.
 *
 * Kept free of Electron so it unit-tests with an injected `fetch`.
 */
export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const part = `${dest}.part`;

  const controller = new AbortController();
  let stalled = false;
  let timer: NodeJS.Timeout | null = null;
  const armStallTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallTimeoutMs);
  };

  try {
    await mkdir(dirname(dest), { recursive: true });

    armStallTimer();
    const res = await fetchImpl(url, { headers: options.headers, signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new UserFacingError(`SDE download failed: HTTP ${res.status}`);
    }

    const totalBytes = Number(res.headers.get('content-length') ?? 0);
    let receivedBytes = 0;

    const counting = new Readable({ read() {} });
    const reader = res.body.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armStallTimer();
          receivedBytes += value.byteLength;
          options.onProgress?.({ receivedBytes, totalBytes });
          counting.push(Buffer.from(value));
        }
        counting.push(null);
      } catch (err) {
        counting.destroy(err as Error);
      }
    })();

    await pipeline(counting, createWriteStream(part));

    // Only meaningful for an identity body: with a Content-Encoding, fetch
    // hands over decoded bytes and the header counts the encoded ones.
    const encoded = res.headers.get('content-encoding') !== null;
    if (totalBytes > 0 && !encoded && receivedBytes !== totalBytes) {
      throw new UserFacingError(
        `SDE download was cut short (${receivedBytes} of ${totalBytes} bytes). Try the import again.`,
      );
    }

    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true }).catch(() => {});
    if (stalled) {
      throw new UserFacingError(
        `SDE download stalled — no data for ${Math.round(stallTimeoutMs / 1000)} seconds. Check your connection and try the import again.`,
      );
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
