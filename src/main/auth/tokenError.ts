/**
 * A non-2xx answer from the EVE SSO token endpoint, and the one judgement made
 * from it: whether the stored refresh token is dead.
 *
 * Kept apart from `esi-oauth.ts` so that judgement is unit-testable — it
 * decides whether a character is shown as "login expired", and getting it wrong
 * in the pessimistic direction deauthorizes a whole fleet over one bad minute.
 */
export class TokenRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Token endpoint returned ${status}: ${body}`);
    this.name = 'TokenRequestError';
  }

  /** The OAuth error code from the response body, if it carried one (RFC 6749 §5.2). */
  get oauthError(): string | null {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
      return typeof parsed.error === 'string' ? parsed.error : null;
    } catch {
      return null;
    }
  }

  /**
   * Whether SSO rejected the *refresh token itself* — expired, revoked, or its
   * family invalidated — rather than refusing the request for some other reason.
   *
   * Only `invalid_grant` means the stored token is dead. Everything else is
   * either a bug in the request we sent (`invalid_request`, `invalid_client`)
   * or a transient service condition (SSO's own throttling, an outage answering
   * 4xx), and treating those as a dead token is how one bad minute during a
   * sweep marks ~90 characters "login expired" at once. The cost of being wrong
   * the other way is small and self-correcting: the character keeps failing
   * sync until the next successful refresh clears it.
   */
  get isRefreshTokenRejected(): boolean {
    return this.oauthError === 'invalid_grant';
  }
}
