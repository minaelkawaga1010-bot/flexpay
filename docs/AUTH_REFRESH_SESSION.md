# Stateful Refresh Sessions (TASK-AUTH-R2)

Remediation of the confirmed HIGH-severity refresh-token **replay / no-revocation**
weakness (TASK-AUTH-R1). Refresh tokens are no longer trust-the-JWT-only; each is
bound to a server-side, PostgreSQL-authoritative session row.

## Architecture
- **Store:** `refresh_sessions` table (additive migration `20261105000001_refresh_sessions`).
  Only a **SHA-256 hash of the refresh JWT `jti`** is stored — never a raw token.
- **Fields:** `familyId` (one login → one family), `jtiHash` (unique), `subjectId`
  + `subjectType` (EMPLOYEE/COMPANY, kept separate — no shared id space), `expiresAt`
  (per-token, mirrors the 7d refresh exp), `familyExpiresAt` (absolute cap),
  `consumedAt`, `replacedByJtiHash` (lineage), `revokedAt`, `revokedReason`.
- **Issuance** (`refreshSessionService.issue`) on employee OTP-verify, company
  register, company login: create a new family + persist the first session, then
  sign the access + refresh tokens (the refresh carries the session's `jti`).
- **Rotation** (`refreshSessionService.rotate`) on `/auth/refresh`: verify the JWT
  (unchanged crypto), reject admin, look up the session by `jtiHash`, then:
  - unknown row → `REFRESH_SESSION_NOT_FOUND` (401) — no fallback;
  - revoked → 401; already-consumed → **reuse detected** → revoke the whole
    family + sanitized audit → 401; expired (token or family) → 401;
  - subject blocked/suspended → **revoke all the subject's sessions** → 403;
  - else **atomically consume** the row (guarded `updateMany` on `consumedAt IS
    NULL` inside a `$transaction`) and create the replacement in the same
    transaction. Exactly one concurrent caller can win; losers get 401.

## Guarantees
- **Single-use rotation:** a rotated token is marked `consumedAt` and cannot be
  used again.
- **Replay / reuse detection:** presenting a consumed token revokes the entire
  token family (all descendants) and writes a sanitized `REFRESH_REUSE_DETECTED`
  audit event (hash **prefix** only — never a raw token/jti).
- **Concurrency:** the guarded single-statement `UPDATE ... WHERE consumedAt IS
  NULL` is atomic under PostgreSQL row locking; across multiple app processes
  sharing the same database exactly one refresh succeeds.
- **Fail-closed:** PostgreSQL is authoritative. There is **no process-local
  fallback** for session state; if the store is unavailable the DB call throws
  and the refresh fails (never issues tokens).
- **Logout:** `/auth/logout` revokes the presented token's family server-side
  (idempotent). This is **single-session** (one device chain).
- **All-session revocation:** `revokeAllForSubject` (invoked when a blocked
  employee / suspended company attempts refresh) revokes every active session
  for the subject — distinct from single-session logout.

## Access-token revocation boundary (IMPORTANT)
Revoking refresh capability does **NOT** invalidate an already-issued **access
token**; access tokens remain valid until their **15-minute** expiry. The
per-request `authenticate()` middleware independently re-checks the account is
`ACTIVE`, so a blocked/suspended subject is cut off on the next request; but an
ordinary logout does not kill an outstanding access token for up to 15 minutes.
Immediate access-token revocation would require an access-token denylist (store
+ check an access `jti` on every request) — **out of scope** for this task and
recorded as a residual control.

## Absolute family lifetime
`FAMILY_ABSOLUTE_TTL_SECONDS = 30 days`. Rolling single-use rotation keeps a
session alive within this window; past it the family stops refreshing and the
user must re-authenticate. The per-token refresh exp (7d) is unchanged and is
additionally capped by the family cap on each rotation. **UX:** an actively used
session re-logins at most every 30 days; an idle session still expires at 7 days.

## Legacy / outstanding stateless tokens
Refresh tokens issued **before** this change have a valid signature but **no**
`refresh_sessions` row. On first use they are rejected (`REFRESH_SESSION_NOT_FOUND`)
— they are **not** grandfathered, so they cannot bypass the new session checks.
**Deployment implication:** at rollout every outstanding refresh token is
invalidated; users perform **one** re-login. Access tokens already in hand keep
working until their 15-minute expiry.

## Duplicate requests / lost responses
A benign client that fires two refreshes of the same token concurrently gets
exactly one success; the loser receives 401 (token already used) without family
revocation when it observed the token as still-unconsumed. A client that retries
an **already-completed** refresh (e.g. a lost response) re-presents a consumed
token and therefore triggers family revocation and a re-login — the secure,
standard behavior (OAuth 2 Security BCP), **not** a permissive replay bypass.
Clients should single-flight refresh and always switch to the newly returned
refresh token.

## CSRF note
The refresh cookie is `HttpOnly; SameSite=strict; Secure(prod)`, which is the
CSRF control for the cookie-carried refresh path; the JSON-body path is used by
mobile/CLI clients that cannot read cookies. Body takes precedence over cookie.
No signing secret or key material is changed by this task.
