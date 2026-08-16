import { describe, expect, it } from 'vitest';
import { TokenRequestError } from '@main/auth/tokenError';

const sso = (status: number, body: string): TokenRequestError =>
  new TokenRequestError(status, body);

describe('TokenRequestError.oauthError', () => {
  it('reads the error code out of an OAuth error body', () => {
    expect(
      sso(400, '{"error":"invalid_grant","error_description":"Invalid refresh token"}').oauthError,
    ).toBe('invalid_grant');
  });

  it('is null when the body is not JSON, or carries no error code', () => {
    expect(sso(502, '<html>Bad Gateway</html>').oauthError).toBeNull();
    expect(sso(400, '').oauthError).toBeNull();
    expect(sso(400, '{"message":"nope"}').oauthError).toBeNull();
    expect(sso(400, '{"error":42}').oauthError).toBeNull();
  });
});

describe('TokenRequestError.isRefreshTokenRejected', () => {
  it('is true only for invalid_grant — the token really is dead', () => {
    expect(sso(400, '{"error":"invalid_grant"}').isRefreshTokenRejected).toBe(true);
  });

  it('is false for our own bad request, which must not deauthorize a character', () => {
    expect(sso(400, '{"error":"invalid_request"}').isRefreshTokenRejected).toBe(false);
    expect(sso(401, '{"error":"invalid_client"}').isRefreshTokenRejected).toBe(false);
    expect(sso(400, '{"error":"unsupported_grant_type"}').isRefreshTokenRejected).toBe(false);
  });

  it('is false when SSO throttles or fails — the case that would mark a whole fleet expired', () => {
    expect(sso(429, '{"error":"too_many_requests"}').isRefreshTokenRejected).toBe(false);
    expect(sso(400, 'Bad Request').isRefreshTokenRejected).toBe(false);
    expect(sso(403, '<html>blocked</html>').isRefreshTokenRejected).toBe(false);
    expect(sso(503, 'Service Unavailable').isRefreshTokenRejected).toBe(false);
  });

  it('keeps the status and body for the log', () => {
    const err = sso(400, '{"error":"invalid_grant"}');
    expect(err.status).toBe(400);
    expect(err.message).toContain('400');
    expect(err.message).toContain('invalid_grant');
    expect(err.name).toBe('TokenRequestError');
  });
});
