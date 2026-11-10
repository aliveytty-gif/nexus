import assert from "node:assert/strict";
import { it } from "node:test";
import {
  applyRecoveryPassword,
  isRecoveryToken,
  recoveryFormId,
  sendRecoveryEmail,
} from "../src/features/auth/recovery.ts";
import {
  readAuthEmail,
  validateRecoveryPassword,
} from "../src/features/auth/validation.ts";

const config = { url: "https://test-project.supabase.co", key: "publishable-test" };
const token = "a".repeat(56);
const user = { id: "recovered-user", email: "recover@example.test" };
const session = {
  access_token: "recovery-access-token",
  refresh_token: "recovery-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user,
};

it("normalizes recovery email and validates the password without changing whitespace", () => {
  const form = new FormData();
  form.set("email", " RECOVER@EXAMPLE.TEST ");
  form.set("password", " new password ");
  form.set("password_confirmation", "new password");
  assert.deepEqual(readAuthEmail(form), {
    email: "recover@example.test",
    valid: true,
  });
  assert.deepEqual(validateRecoveryPassword(form), { error: "Пароли не совпадают." });
  form.set("password_confirmation", " new password ");
  assert.deepEqual(validateRecoveryPassword(form), { password: " new password " });
  for (const invalid of ["short", "x".repeat(129)]) {
    form.set("password", invalid);
    form.set("password_confirmation", invalid);
    assert.deepEqual(validateRecoveryPassword(form), {
      error: "Пароль должен содержать от 8 до 128 символов.",
    });
  }
});

it("bounds the token format and derives a different form ID for each link", () => {
  assert.equal(isRecoveryToken(token), true);
  assert.equal(isRecoveryToken("a".repeat(129)), false);
  assert.equal(isRecoveryToken(`${token}?next=/login`), false);
  assert.equal(isRecoveryToken([token]), false);
  assert.notEqual(recoveryFormId(token), token);
  assert.notEqual(recoveryFormId(token), recoveryFormId("b".repeat(56)));
});

it("uses the configured recovery URL and masks email-dependent Auth failures", async (t) => {
  const redirects: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/auth/v1/recover");
    redirects.push(url.searchParams.get("redirect_to") ?? "");
    const { email, code_challenge } = JSON.parse(String(init.body));
    assert.equal(code_challenge, null);
    return email === user.email
      ? Response.json({})
      : Response.json({ code: "user_not_found" }, { status: 404 });
  });

  const present = await sendRecoveryEmail(config, user.email, "http://localhost:3000");
  const absent = await sendRecoveryEmail(config, "other@example.test", "https://preview.example");
  assert.deepEqual(absent, present);
  assert.deepEqual(redirects, [
    "http://localhost:3000/auth/recovery",
    "https://preview.example/auth/recovery",
  ]);
});

it("updates only with the freshly verified recovery session and rejects a replay", async (t) => {
  const calls: string[] = [];
  let consumed = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/verify") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.type, "recovery");
      assert.equal(body.token_hash, token);
      if (consumed) return Response.json({ code: "otp_expired" }, { status: 403 });
      consumed = true;
      return Response.json(session);
    }
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${session.access_token}`);
    if (url.pathname === "/auth/v1/user") {
      assert.equal(init.method, "PUT");
      assert.equal(JSON.parse(String(init.body)).password, "new password");
      return Response.json(user);
    }
    assert.equal(url.pathname, "/auth/v1/logout");
    assert.equal(url.searchParams.get("scope"), "local");
    return new Response(null, { status: 204 });
  });

  assert.equal(await applyRecoveryPassword(config, token, "new password"), "updated");
  assert.equal(await applyRecoveryPassword(config, token, "other password"), "invalid_link");
  assert.deepEqual(calls, ["/auth/v1/verify", "/auth/v1/user", "/auth/v1/logout", "/auth/v1/verify"]);
});

it("does not update without a session or when verification is rate-limited", async (t) => {
  let verification = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(input).pathname, "/auth/v1/verify");
    return verification++ === 0
      ? Response.json({ code: "over_request_rate_limit" }, { status: 429 })
      : Response.json({ user });
  });
  assert.equal(await applyRecoveryPassword(config, token, "new password"), "retry");
  assert.equal(await applyRecoveryPassword(config, token, "new password"), "invalid_link");
});
