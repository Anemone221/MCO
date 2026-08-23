import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bufferStream, processZip } from '@main/sde/zip';

/**
 * The SDE zip mixes packings: CCP deflates the big YAML files but *stores*
 * tiny ones (`_sde.yaml` is 66 bytes, where deflating costs more than it
 * saves). yauzl hands those two cases back as different stream types, and the
 * stored one is a vendored fd-slicer `ReadStream` that marks itself
 * `destroyed` before pushing EOF — so consuming it with `for await` used to
 * hang forever with no error, taking the whole import with it (build 3475087).
 *
 * These build a zip by hand rather than take a zip-writing dependency: the
 * point is to control the compression method per entry, which is the one thing
 * that broke.
 */

const STORED = 0;
const DEFLATED = 8;

interface Entry {
  name: string;
  content: string;
  method: number;
}

function localHeader(entry: Entry, body: Buffer, raw: Buffer): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(crc32(raw), 14);
  header.writeUInt32LE(body.length, 18); // compressed size
  header.writeUInt32LE(raw.length, 22); // uncompressed size
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, name]);
}

function centralHeader(entry: Entry, body: Buffer, raw: Buffer, offset: number): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // central directory signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12); // mod time
  header.writeUInt16LE(0, 14); // mod date
  header.writeUInt32LE(crc32(raw), 16);
  header.writeUInt32LE(body.length, 20);
  header.writeUInt32LE(raw.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function buildZip(entries: Entry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = Buffer.from(entry.content, 'utf8');
    const body = entry.method === DEFLATED ? deflateRawSync(raw) : raw;
    const header = localHeader(entry, body, raw);
    central.push(centralHeader(entry, body, raw, offset));
    local.push(header, body);
    offset += header.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // directory start disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...local, directory, end]);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mco-sde-zip-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeZip(entries: Entry[]): Promise<string> {
  const path = join(dir, 'sde.zip');
  await writeFile(path, buildZip(entries));
  return path;
}

const STORED_YAML = "sde:\n  buildNumber: 3475087\n  releaseDate: '2026-08-20T11:08:35Z'\n";

describe('processZip', () => {
  it('reads a stored entry, not just a deflated one', async () => {
    const path = await writeZip([
      { name: 'categories.yaml', content: 'deflated body\n', method: DEFLATED },
      { name: '_sde.yaml', content: STORED_YAML, method: STORED },
    ]);

    const seen: Record<string, string> = {};
    await processZip(path, {
      'categories.yaml': async (stream) => {
        seen['categories.yaml'] = await bufferStream(stream);
      },
      '_sde.yaml': async (stream) => {
        seen['_sde.yaml'] = await bufferStream(stream);
      },
    });

    expect(seen['categories.yaml']).toBe('deflated body\n');
    expect(seen['_sde.yaml']).toBe(STORED_YAML);
  });

  it('streams a stored entry line by line, the way the big files are read', async () => {
    // `parseTypesStream`/`parseTypeDogmaStream` consume their entry through
    // readline, which async-iterates it — the same thing that hung.
    const path = await writeZip([{ name: 'types.yaml', content: 'a\nb\nc\n', method: STORED }]);

    const lines: string[] = [];
    await processZip(path, {
      'types.yaml': async (stream) => {
        for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
          lines.push(line);
        }
      },
    });

    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('skips entries no handler asked for', async () => {
    const path = await writeZip([
      { name: 'mapMoons.yaml', content: 'huge\n', method: DEFLATED },
      { name: '_sde.yaml', content: STORED_YAML, method: STORED },
    ]);

    const handled: string[] = [];
    await processZip(path, {
      '_sde.yaml': async (stream) => {
        await bufferStream(stream);
        handled.push('_sde.yaml');
      },
    });

    expect(handled).toEqual(['_sde.yaml']);
  });

  it('rejects when a handler throws', async () => {
    const path = await writeZip([{ name: '_sde.yaml', content: STORED_YAML, method: STORED }]);

    await expect(
      processZip(path, {
        '_sde.yaml': async () => {
          throw new Error('bad yaml');
        },
      }),
    ).rejects.toThrow('bad yaml');
  });
});
