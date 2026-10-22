// ============================================================
// Dashboard JWT tests — TASK-006
// No fallback secret, fail closed when misconfigured, and forged,
// tampered, wrong-algorithm, expired or cross-type tokens never verify.
// Secrets are generated per run; no known value is reproduced.
// ============================================================
import { createHmac, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, test, expect } from "./run-tests.ts";
import {
  JwtConfigError,
  KNOWN_COMPROMISED_SHA256,
  getJwtSecrets,
  secretProblem,
  signToken,
  verifySignedToken,
} from "../lib/jwt.ts";

const randomSecret = () => randomBytes(48).toString("hex");
const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function withSecrets(access: string | undefined, refresh: string | undefined, fn: () => void): void {
  const saved = { a: process.env.JWT_ACCESS_SECRET, r: process.env.JWT_REFRESH_SECRET };
  if (access === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = access;
  if (refresh === undefined) delete process.env.JWT_REFRESH_SECRET;
  else process.env.JWT_REFRESH_SECRET = refresh;
  try {
    fn();
  } finally {
    if (saved.a === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = saved.a;
    if (saved.r === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = saved.r;
  }
}

function craft(header: object, payload: object, algo: "sha256" | "sha512", secret: string): string {
  const head = b64(header);
  const body = b64(payload);
  const sig = createHmac(algo, secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const goodClaims = (overrides: Record<string, unknown> = {}) => ({
  userId: "user-1",
  phone: "+971500000000",
  role: "EMPLOYEE",
  type: "access",
  iss: "flexpay-dashboard",
  aud: "flexpay-dashboard",
  iat: Date.now(),
  exp: Date.now() + 60_000,
  ...overrides,
});

describe("dashboard JWT secret policy — no fallback", () => {
  test("missing, short, placeholder and low-variety secrets are rejected", () => {
    expect(secretProblem(undefined) !== null).toBe(true);
    expect(secretProblem("") !== null).toBe(true);
    expect(secretProblem("   ") !== null).toBe(true);
    expect(secretProblem(randomSecret().slice(0, 31)) !== null).toBe(true);
    expect(secretProblem(`change-me-${randomSecret()}`) !== null).toBe(true);
    expect(secretProblem("a".repeat(64)) !== null).toBe(true);
    expect(secretProblem(randomSecret())).toBeNull();
  });

  test("compromised list matches the backend policy exactly", () => {
    const backend = readFileSync(join(import.meta.dir, "../../../src/config/jwt-secret-policy.ts"), "utf8");
    const backendHashes = [...backend.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]).sort();
    expect(backendHashes.length).toBe(15);
    expect([...KNOWN_COMPROMISED_SHA256].sort()).toEqual(backendHashes);
  });

  test("signing throws while secrets are missing — nothing falls back", () => {
    withSecrets(undefined, undefined, () => {
      expect(() => signToken({ userId: "u", type: "access" }, 60_000)).toThrow("JWT_ACCESS_SECRET");
    });
  });

  test("verification fails closed while secrets are misconfigured, without logging values", () => {
    const placeholder = `change-me-${randomSecret()}`;
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
    try {
      let token = "";
      withSecrets(randomSecret(), randomSecret(), () => {
        token = signToken({ userId: "u", type: "access" }, 60_000);
      });
      withSecrets(placeholder, randomSecret(), () => {
        expect(verifySignedToken(token)).toBeNull();
      });
    } finally {
      console.error = original;
    }
    expect(logged.join("\n").includes(placeholder)).toBe(false);
  });

  test("access and refresh must use different secrets", () => {
    const shared = randomSecret();
    withSecrets(shared, shared, () => {
      let threw = false;
      try {
        getJwtSecrets();
      } catch (err) {
        threw = err instanceof JwtConfigError;
      }
      expect(threw).toBe(true);
    });
  });
});

describe("dashboard JWT verification — adversarial tokens", () => {
  const access = randomSecret();
  const refresh = randomSecret();

  test("genuine access and refresh tokens round-trip with pinned claims", () => {
    withSecrets(access, refresh, () => {
      const a = verifySignedToken(signToken({ userId: "user-1", role: "EMPLOYEE", phone: "+971500000000", type: "access" }, 60_000));
      expect(a?.userId).toBe("user-1");
      expect(a?.type).toBe("access");
      expect(a?.iss).toBe("flexpay-dashboard");
      const r = verifySignedToken(signToken({ userId: "user-1", type: "refresh" }, 60_000), "refresh");
      expect(r?.type).toBe("refresh");
    });
  });

  test("a token signed with any other secret is rejected", () => {
    withSecrets(access, refresh, () => {
      expect(verifySignedToken(craft({ alg: "HS256", typ: "JWT" }, goodClaims(), "sha256", randomSecret()))).toBeNull();
    });
  });

  test("a tampered payload is rejected", () => {
    withSecrets(access, refresh, () => {
      const [head, , sig] = signToken({ userId: "user-1", type: "access" }, 60_000).split(".");
      expect(verifySignedToken(`${head}.${b64(goodClaims({ userId: "admin-1", role: "ADMIN" }))}.${sig}`)).toBeNull();
    });
  });

  test("alg=none, HS512 and extra header fields are rejected", () => {
    withSecrets(access, refresh, () => {
      const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(goodClaims())}.`;
      expect(verifySignedToken(none)).toBeNull();
      expect(verifySignedToken(craft({ alg: "HS512", typ: "JWT" }, goodClaims(), "sha512", access))).toBeNull();
      expect(verifySignedToken(craft({ alg: "HS256", typ: "JWT", kid: "x" }, goodClaims(), "sha256", access))).toBeNull();
    });
  });

  test("expired, exp-less and wrong-issuer/audience tokens are rejected", () => {
    withSecrets(access, refresh, () => {
      const header = { alg: "HS256", typ: "JWT" };
      expect(verifySignedToken(craft(header, goodClaims({ exp: Date.now() - 1 }), "sha256", access))).toBeNull();
      const { exp: _exp, ...noExp } = goodClaims();
      expect(verifySignedToken(craft(header, noExp, "sha256", access))).toBeNull();
      expect(verifySignedToken(craft(header, goodClaims({ iss: "attacker" }), "sha256", access))).toBeNull();
      expect(verifySignedToken(craft(header, goodClaims({ aud: "other" }), "sha256", access))).toBeNull();
      // Control: the same construction with valid claims does verify.
      expect(verifySignedToken(craft(header, goodClaims(), "sha256", access))?.userId).toBe("user-1");
    });
  });

  test("access and refresh tokens are not interchangeable", () => {
    withSecrets(access, refresh, () => {
      const accessToken = signToken({ userId: "user-1", type: "access" }, 60_000);
      expect(verifySignedToken(accessToken, "refresh")).toBeNull();
      // Signed with the ACCESS secret but claiming refresh: wrong key → rejected.
      const header = { alg: "HS256", typ: "JWT" };
      expect(verifySignedToken(craft(header, goodClaims({ type: "refresh" }), "sha256", access))).toBeNull();
    });
  });

  test("malformed strings are rejected", () => {
    withSecrets(access, refresh, () => {
      for (const junk of ["", "abc", "a.b", "a.b.c", "..."]) {
        expect(verifySignedToken(junk)).toBeNull();
      }
    });
  });
});
