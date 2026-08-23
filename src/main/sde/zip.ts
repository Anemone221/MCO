/**
 * Reading entries out of the SDE zip.
 *
 * Split out of `importer.ts` so it carries no database or Electron dependency
 * and can be unit-tested against a synthetic zip — the packing of an entry is
 * CCP's choice, changes without notice, and has already broken an import once.
 */
import { PassThrough, type Readable } from 'node:stream';
import yauzl from 'yauzl';

export type ZipEntryHandler = (stream: Readable) => Promise<void>;

/** Read one entry into a string. */
export async function bufferStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Walk `zipPath` and hand every entry named in `handlers` to its handler, one
 * at a time. Entries nobody asked for are skipped without being decompressed —
 * the SDE zip is ~100 MB and MCO reads nine of its hundred-odd files.
 *
 * Handlers run sequentially (`lazyEntries`, one `readEntry()` per completion)
 * so peak memory stays at one file's worth, not the archive's.
 */
export function processZip(
  zipPath: string,
  handlers: Record<string, ZipEntryHandler>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open SDE zip'));

      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        const handler = handlers[entry.fileName];
        if (!handler) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error('Could not read entry'));
          // Piped through a PassThrough rather than handed over directly.
          // yauzl only wraps a *deflated* entry in a stream of its own; for a
          // **stored** entry it returns its vendored fd-slicer `ReadStream`,
          // which marks itself `destroyed` before it pushes EOF. Node then
          // refuses to drain the bytes still buffered, so `for await` (and
          // readline, which the big files stream through) waits on an 'end'
          // that never comes: the import hangs with no error, forever, and the
          // banner spins until the app is killed. CCP began storing
          // `_sde.yaml` in build 3475087, which is how that surfaced. The pipe
          // puts the source in flowing mode and hands the handler a stock
          // stream, so how any one entry was packed stops mattering.
          handler(stream.pipe(new PassThrough()))
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}
