import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeNextPath } from "../src/lib/auth/redirect.ts";
import { validateAuthInput } from "../src/features/auth/validation.ts";
import { validateProfileInput } from "../src/features/profiles/validation.ts";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value])
      data.append(key, item);
  }
  return data;
};

describe("auth redirect boundary", () => {
  it("accepts known private destinations including profile setup", () => {
    for (const path of [
      "/feed",
      "/profile/edit",
      "/profile/student_21",
      "/messages",
      "/map",
      "/ai",
      "/posts/12345678-1234-1234-1234-123456789abc",
    ]) {
      assert.equal(safeNextPath(path), path);
    }
  });
  it("rejects external, malformed, encoded and unrecognized destinations", () => {
    const values = [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/feed/../../auth/callback",
      "/feed?next=https://evil.example",
      "/feed#evil",
      "/%2f%2fevil.example",
      "/%5cevil.example",
      "/feed%0d%0aLocation:evil",
      "/login",
      "/api/admin",
      " /feed",
      "/feed\n",
      ["/feed"],
      null,
      undefined,
    ];
    for (const value of values)
      assert.equal(safeNextPath(value, "/profile/edit"), "/profile/edit");
  });
});

describe("auth input boundary", () => {
  it("normalizes email and names without changing password whitespace", () => {
    const result = validateAuthInput(
      form({
        email: " STUDENT@EXAMPLE.COM ",
        password: " pass  word ",
        first_name: " Анна ",
        last_name: " Петрова ",
      }),
      true,
    );
    assert.equal(result.valid, true);
    assert.equal(result.email, "student@example.com");
    assert.equal(result.password, " pass  word ");
    assert.equal(result.firstName, "Анна");
  });
  it("rejects missing fields, invalid email and short registration passwords", () => {
    const result = validateAuthInput(
      form({ email: "student", password: "1234567" }),
      true,
    );
    assert.equal(result.valid, false);
    assert.deepEqual(Object.keys(result.fieldErrors).sort(), [
      "email",
      "first_name",
      "last_name",
      "password",
    ]);
  });
  it("lets existing accounts sign in with older short passwords", () => {
    assert.equal(
      validateAuthInput(
        form({ email: "student@example.com", password: "legacy" }),
        false,
      ).valid,
      true,
    );
  });
  it("rejects oversized passwords before invoking Supabase", () => {
    assert.ok(
      validateAuthInput(
        form({ email: "student@example.com", password: "x".repeat(129) }),
        false,
      ).fieldErrors.password,
    );
  });
});

describe("profile update boundary", () => {
  const valid = {
    first_name: "Анна",
    last_name: "Петрова",
    username: "anna_21",
  };
  it("normalizes profile values and keeps optional avatar/course nullable", () => {
    const result = validateProfileInput(
      form({
        ...valid,
        username: " ANNA_21 ",
        bio: " Дизайн ",
        interests: [
          "12345678-1234-1234-1234-123456789abc",
          "12345678-1234-1234-1234-123456789abc",
        ],
      }),
    );
    assert.equal(result.valid, true);
    assert.equal(result.values.p_username, "anna_21");
    assert.equal(result.values.p_avatar_url, null);
    assert.equal(result.values.p_course, null);
    assert.equal(result.values.p_bio, "Дизайн");
    assert.equal(result.values.p_interest_ids.length, 1);
  });
  it("rejects route-reserved and malformed usernames", () => {
    for (const username of [
      "edit",
      "Edit",
      "ab",
      "student/name",
      "my name",
      "кириллица",
      "a".repeat(41),
    ]) {
      assert.ok(
        validateProfileInput(form({ ...valid, username })).fieldErrors.username,
        username,
      );
    }
  });
  it("rejects unsafe avatar URLs and accepts normal HTTPS images", () => {
    for (const avatar_url of [
      "javascript:alert(1)",
      "http://example.com/a.jpg",
      "//example.com/a.jpg",
      "https://user:password@example.com/a.jpg",
      "https://example.com/a b.jpg",
      "https://",
    ]) {
      assert.ok(
        validateProfileInput(form({ ...valid, avatar_url })).fieldErrors
          .avatar_url,
        avatar_url,
      );
    }
    assert.equal(
      validateProfileInput(
        form({ ...valid, avatar_url: "https://example.com/avatar.jpg?v=2" }),
      ).valid,
      true,
    );
  });
  it("enforces course bounds without accepting alternate numeric encodings", () => {
    for (const course of ["0", "7", "-1", "2.5", "1e0", "01", "0x1", "text"]) {
      assert.ok(
        validateProfileInput(form({ ...valid, course })).fieldErrors.course,
        course,
      );
    }
    assert.equal(
      validateProfileInput(form({ ...valid, course: "6" })).values.p_course,
      6,
    );
  });
  it("enforces profile length and selected-interest limits", () => {
    const interests = Array.from(
      { length: 11 },
      (_, n) => `12345678-1234-1234-1234-${n.toString().padStart(12, "0")}`,
    );
    const result = validateProfileInput(
      form({
        ...valid,
        first_name: "a".repeat(81),
        bio: "b".repeat(301),
        specialty: "c".repeat(121),
        group_name: "d".repeat(41),
        interests,
      }),
    );
    assert.deepEqual(Object.keys(result.fieldErrors).sort(), [
      "bio",
      "first_name",
      "group_name",
      "interests",
      "specialty",
    ]);
    assert.ok(
      validateProfileInput(form({ ...valid, interests: ["not-a-uuid"] }))
        .fieldErrors.interests,
    );
  });
});
