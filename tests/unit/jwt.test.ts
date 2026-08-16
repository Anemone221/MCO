import { describe, expect, it, vi } from 'vitest';
import { createHmac, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import {
  JwtVerificationError,
  characterIdFromSub,
  decodeJwtPayload,
  scopesFromPayload,
  verifyAccessToken,
  type JwtHeader,
} from '@main/auth/jwt';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const CLIENT_ID = 'test-client-id';
/** Fixed clock so expiry cases don't depend on wall time. */
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const seconds = (ms: number): number => Math.floor(ms / 1000);

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'CHARACTER:EVE:90000001',
    name: 'Test Pilot',
    iss: 'login.eveonline.com',
    aud: [CLIENT_ID, 'EVE Online'],
    iat: seconds(NOW),
    exp: seconds(NOW) + 1200,
    scp: ['esi-skills.read_skills.v1'],
    ...overrides,
  };
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function assemble(header: object, payload: object, sign: (input: string) => Buffer): string {
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${sign(signingInput).toString('base64url')}`;
}

function rs256(payload: object = claims(), kid = 'JWT-Signature-Key'): string {
  return assemble({ alg: 'RS256', typ: 'JWT', kid }, payload, (input) =>
    cryptoSign('sha256', Buffer.from(input), rsa.privateKey),
  );
}

function es256(payload: object = claims()): string {
  return assemble({ alg: 'ES256', typ: 'JWT', kid: 'ec-key' }, payload, (input) =>
    // JWS wants raw r‖s, not Node's default DER.
    cryptoSign('sha256', Buffer.from(input), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }),
  );
}

const withKey =
  (key: KeyObject) =>
  (): Promise<KeyObject> =>
    Promise.resolve(key);

const verify = (jwt: string, key: KeyObject = rsa.publicKey, now = NOW): Promise<unknown> =>
  verifyAccessToken(jwt, { resolveKey: withKey(key), clientId: CLIENT_ID, now });

describe('verifyAccessToken — signature', () => {
  it('accepts an RS256 token signed by the expected key', async () => {
    await expect(verify(rs256())).resolves.toMatchObject({
      sub: 'CHARACTER:EVE:90000001',
      name: 'Test Pilot',
    });
  });

  it('accepts an ES256 token (raw r‖s signature encoding)', async () => {
    await expect(verify(es256(), ec.publicKey)).resolves.toMatchObject({ name: 'Test Pilot' });
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const [header, , signature] = rs256().split('.') as [string, string, string];
    const tampered = `${header}.${encode(claims({ sub: 'CHARACTER:EVE:99999999' }))}.${signature}`;
    await expect(verify(tampered)).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a token signed by a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(verify(rs256(), other.publicKey)).rejects.toThrow(/signature does not match/i);
  });

  it('rejects alg: none', async () => {
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims())}.`;
    await expect(verify(unsigned)).rejects.toThrow(/Unsupported JWT algorithm: none/);
  });

  it('rejects HS256 forged with the public key as the HMAC secret', async () => {
    // The classic alg-confusion attack: the "secret" is public, so this token
    // verifies unless the algorithm allowlist refuses it first.
    const pem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const forged = assemble({ alg: 'HS256', typ: 'JWT' }, claims(), (input) =>
      createHmac('sha256', pem).update(input).digest(),
    );
    await expect(verify(forged)).rejects.toThrow(/Unsupported JWT algorithm: HS256/);
  });

  it('rejects a key whose type cannot verify the header algorithm', async () => {
    await expect(verify(es256(), rsa.publicKey)).rejects.toThrow(/cannot verify ES256/);
  });

  it('surfaces a key-lookup failure as a verification failure', async () => {
    const resolveKey = (): Promise<KeyObject> =>
      Promise.reject(new Error('Could not fetch the EVE SSO signing keys: offline'));
    await expect(
      verifyAccessToken(rs256(), { resolveKey, clientId: CLIENT_ID, now: NOW }),
    ).rejects.toThrow(/Could not fetch the EVE SSO signing keys/);
  });

  it('passes the header kid through to key resolution', async () => {
    const resolveKey = vi.fn((_header: JwtHeader) => Promise.resolve(rsa.publicKey));
    await verifyAccessToken(rs256(claims(), 'rotated-key'), {
      resolveKey,
      clientId: CLIENT_ID,
      now: NOW,
    });
    expect(resolveKey).toHaveBeenCalledWith(
      expect.objectContaining({ kid: 'rotated-key', alg: 'RS256' }),
    );
  });

  it('rejects a malformed token', async () => {
    await expect(verify('not-a-jwt')).rejects.toThrow(/expected three segments/);
    await expect(verify('a.b.c')).rejects.toThrow(JwtVerificationError);
  });
});

describe('verifyAccessToken — claims', () => {
  it('accepts the https form of the issuer', async () => {
    await expect(verify(rs256(claims({ iss: 'https://login.eveonline.com' })))).resolves.toBeTruthy();
  });

  it('rejects a token from another issuer', async () => {
    await expect(verify(rs256(claims({ iss: 'login.evil.example' })))).rejects.toThrow(
      /Unexpected JWT issuer/,
    );
  });

  it('rejects a token issued for a different application', async () => {
    await expect(verify(rs256(claims({ aud: ['some-other-client', 'EVE Online'] })))).rejects.toThrow(
      /audience does not include this application/,
    );
  });

  it('accepts a bare-string aud equal to the client id', async () => {
    await expect(verify(rs256(claims({ aud: CLIENT_ID })))).resolves.toBeTruthy();
  });

  it('rejects an expired token', async () => {
    await expect(verify(rs256(claims({ exp: seconds(NOW) - 90 })))).rejects.toThrow(/has expired/);
  });

  it('tolerates a minute of clock skew on exp', async () => {
    await expect(verify(rs256(claims({ exp: seconds(NOW) - 30 })))).resolves.toBeTruthy();
  });

  it('rejects a token that is not valid yet', async () => {
    await expect(verify(rs256(claims({ nbf: seconds(NOW) + 600 })))).rejects.toThrow(
      /not valid yet/,
    );
  });

  it('rejects a token with no exp claim', async () => {
    const noExp = claims();
    delete noExp['exp'];
    await expect(verify(rs256(noExp))).rejects.toThrow(/no exp claim/);
  });
});

describe('decodeJwtPayload', () => {
  it('decodes the payload segment of a JWT', () => {
    const payload = { sub: 'CHARACTER:EVE:90000001', name: 'Test Pilot' };
    const jwt = `${encode({})}.${encode(payload)}.sig`;
    expect(decodeJwtPayload(jwt)).toEqual(payload);
  });

  it('throws on a malformed token', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow();
  });
});

describe('scopesFromPayload', () => {
  it('returns an array scp claim as-is', () => {
    expect(scopesFromPayload({ scp: ['a.v1', 'b.v1'] })).toEqual(['a.v1', 'b.v1']);
  });

  it('wraps a single-string scp claim (EVE SSO single-scope form)', () => {
    expect(scopesFromPayload({ scp: 'a.v1' })).toEqual(['a.v1']);
  });

  it('returns empty for a missing scp claim', () => {
    expect(scopesFromPayload({})).toEqual([]);
  });
});

describe('characterIdFromSub', () => {
  it('extracts the numeric id from the sub claim', () => {
    expect(characterIdFromSub('CHARACTER:EVE:90000001')).toBe(90000001);
  });

  it('throws when the sub claim is missing or invalid', () => {
    expect(() => characterIdFromSub(undefined)).toThrow();
    expect(() => characterIdFromSub('CHARACTER:EVE:notanumber')).toThrow();
  });
});
