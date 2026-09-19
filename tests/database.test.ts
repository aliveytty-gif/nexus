import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// This executes the real migration in PostgreSQL/WASM. Only Supabase's Auth
// schema/session bridge is emulated; table constraints, grants, RLS, and RPCs
// execute as PostgreSQL, without a network, Docker, or live credentials.
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const FUTURE_USER = "33333333-3333-4333-8333-333333333333";
const MUSIC = "10000000-0000-4000-8000-000000000001";
const PROGRAMMING = "10000000-0000-4000-8000-000000000002";
const UNKNOWN_INTEREST = "99999999-9999-4999-8999-999999999999";
const DEFAULT_ALICE_USERNAME = `u_${ALICE.replaceAll("-", "")}`;
const PROFILE_RPC = `select public.update_my_profile(
  $1, $2, $3, $4, $5, $6, $7::integer, $8, $9::uuid[]
)`;

describe(
  "NEXUS PostgreSQL migration and security",
  { concurrency: false },
  () => {
    let db: PGlite;

    before(async () => {
      db = new PGlite();
      await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      -- Reproduce legacy Supabase default privileges to test their revocation.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
    `);
      const migration = await readFile(
        new URL(
          "../supabase/migrations/202609150001_core.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.exec(migration);
    });

    beforeEach(async () => {
      await db.exec("reset role; truncate auth.users cascade;");
      await db.query(
        `insert into auth.users (id, raw_user_meta_data) values
      ($1, '{"first_name":"Алиса","last_name":"Иванова","username":"ignored"}'),
      ($2, '{"first_name":"Борис","last_name":"Петров"}')`,
        [ALICE, BOB],
      );
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    });

    after(async () => {
      await db?.close();
    });

    async function asUser<T>(
      id: string | null,
      operation: () => Promise<T>,
    ): Promise<T> {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id ?? "",
      ]);
      await db.exec("set role authenticated");
      try {
        return await operation();
      } finally {
        await db.exec("reset role");
      }
    }

    async function createPost(authorId = ALICE, content = "Первый пост") {
      const result = await asUser(authorId, () =>
        db.query<{ id: string }>(
          "insert into public.posts (author_id, content) values ($1, $2) returning id",
          [authorId, content],
        ),
      );
      assert.ok(result.rows[0]);
      return result.rows[0].id;
    }

    async function createComment(postId: string, authorId = BOB) {
      const result = await asUser(authorId, () =>
        db.query<{ id: string }>(
          "insert into public.comments (post_id, author_id, content) values ($1, $2, $3) returning id",
          [postId, authorId, "Комментарий"],
        ),
      );
      assert.ok(result.rows[0]);
      return result.rows[0].id;
    }

    async function saveProfile(
      username: string,
      interestIds: (string | null)[] = [MUSIC],
    ) {
      return db.query(PROFILE_RPC, [
        " Алиса ",
        " Иванова ",
        username,
        "",
        " О себе ",
        "Разработка",
        2,
        "ИС-21",
        interestIds,
      ]);
    }

    it("creates a profile from signup metadata, with an ID-derived unique username", async () => {
      const result = await db.query<{
        id: string;
        first_name: string;
        username: string;
      }>("select id, first_name, username from public.profiles where id = $1", [
        ALICE,
      ]);
      assert.deepEqual(result.rows[0], {
        id: ALICE,
        first_name: "Алиса",
        username: DEFAULT_ALICE_USERNAME,
      });
      const catalog = await db.query<{ name: string }>(
        "select name from public.interests order by id",
      );
      assert.deepEqual(
        catalog.rows.map((interest) => interest.name),
        [
          "музыка",
          "программирование",
          "спорт",
          "игры",
          "дизайн",
          "фото",
          "кино",
        ],
      );
    });

    it("prevents username squatting from breaking a future signup", async () => {
      await asUser(ALICE, async () => {
        await assert.rejects(
          () => saveProfile(`u_${FUTURE_USER.replaceAll("-", "")}`),
          { code: "23514" },
        );
      });
      await db.query("insert into auth.users (id) values ($1)", [FUTURE_USER]);
      const result = await db.query<{ username: string }>(
        "select username from public.profiles where id = $1",
        [FUTURE_USER],
      );
      assert.equal(
        result.rows[0]?.username,
        `u_${FUTURE_USER.replaceAll("-", "")}`,
      );
    });

    it("truncates oversized signup metadata instead of breaking registration", async () => {
      await db.query(
        "insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)",
        [
          FUTURE_USER,
          JSON.stringify({ first_name: "я".repeat(1000), last_name: null }),
        ],
      );
      const result = await db.query<{ first_name: string; last_name: string }>(
        "select first_name, last_name from public.profiles where id = $1",
        [FUTURE_USER],
      );
      assert.equal(result.rows[0]?.first_name.length, 80);
      assert.equal(result.rows[0]?.last_name, "");
    });

    it("denies anonymous reads, writes, and RPC execution", async () => {
      await db.exec("set role anon");
      try {
        for (const table of [
          "profiles",
          "posts",
          "comments",
          "interests",
          "profile_interests",
        ]) {
          await assert.rejects(
            () => db.query(`select * from public.${table}`),
            { code: "42501" },
          );
        }
        await assert.rejects(
          () =>
            db.query(
              "insert into public.posts (author_id, content) values ($1, $2)",
              [ALICE, "x"],
            ),
          { code: "42501" },
        );
        await assert.rejects(() => saveProfile("alice"), { code: "42501" });
      } finally {
        await db.exec("reset role");
      }
    });

    it("requires a real user ID even when the authenticated role is selected", async () => {
      await asUser(null, async () => {
        const result = await db.query("select * from public.profiles");
        assert.equal(result.rows.length, 0);
        await assert.rejects(() => saveProfile("alice"), { code: "28000" });
      });
    });

    it("allows authenticated users to read other profiles, posts, and comments", async () => {
      const postId = await createPost();
      await createComment(postId);
      await asUser(BOB, async () => {
        const profiles = await db.query("select * from public.profiles");
        const posts = await db.query("select * from public.posts");
        const comments = await db.query("select * from public.comments");
        assert.equal(profiles.rows.length, 2);
        assert.equal(posts.rows.length, 1);
        assert.equal(comments.rows.length, 1);
      });
    });

    it("blocks forged authors and writes to another user’s profile, posts, or interests", async () => {
      const postId = await createPost();
      await asUser(ALICE, () => saveProfile("alice", [MUSIC]));
      await asUser(BOB, async () => {
        const profile = await db.query(
          "update public.profiles set bio = $1 where id = $2 returning id",
          ["hacked", ALICE],
        );
        const post = await db.query(
          "update public.posts set content = $1 where id = $2 returning id",
          ["hacked", postId],
        );
        const deletion = await db.query(
          "delete from public.posts where id = $1 returning id",
          [postId],
        );
        const interests = await db.query(
          "delete from public.profile_interests where profile_id = $1 returning profile_id",
          [ALICE],
        );
        assert.equal(profile.rows.length, 0);
        assert.equal(post.rows.length, 0);
        assert.equal(deletion.rows.length, 0);
        assert.equal(interests.rows.length, 0);
        await assert.rejects(
          () =>
            db.query(
              "insert into public.posts (author_id, content) values ($1, $2)",
              [ALICE, "Forged"],
            ),
          { code: "42501" },
        );
        await assert.rejects(
          () =>
            db.query(
              "insert into public.profile_interests (profile_id, interest_id) values ($1, $2)",
              [ALICE, PROGRAMMING],
            ),
          { code: "42501" },
        );
      });
    });

    it("allows deleting and updating own comments while blocking another author", async () => {
      const postId = await createPost();
      const commentId = await createComment(postId);
      await asUser(ALICE, async () => {
        const updated = await db.query(
          "update public.comments set content = $1 where id = $2 returning id",
          ["hacked", commentId],
        );
        const deleted = await db.query(
          "delete from public.comments where id = $1 returning id",
          [commentId],
        );
        assert.equal(updated.rows.length, 0);
        assert.equal(deleted.rows.length, 0);
        await assert.rejects(
          () =>
            db.query(
              "insert into public.comments (post_id, author_id, content) values ($1, $2, $3)",
              [postId, BOB, "Forged"],
            ),
          { code: "42501" },
        );
      });
      await asUser(BOB, async () => {
        const updated = await db.query<{ content: string }>(
          "update public.comments set content = $1 where id = $2 returning content",
          ["Исправлено", commentId],
        );
        assert.equal(updated.rows[0]?.content, "Исправлено");
        const deleted = await db.query(
          "delete from public.comments where id = $1 returning id",
          [commentId],
        );
        assert.equal(deleted.rows.length, 1);
      });
    });

    it("protects identity, author, timestamp, and comment-parent columns", async () => {
      const postId = await createPost();
      const commentId = await createComment(postId, ALICE);
      await asUser(ALICE, async () => {
        const deniedQueries = [
          [
            "update public.profiles set id = $1 where id = $2",
            [FUTURE_USER, ALICE],
          ],
          [
            "update public.profiles set created_at = '2000-01-01' where id = $1",
            [ALICE],
          ],
          [
            "update public.profiles set updated_at = '2000-01-01' where id = $1",
            [ALICE],
          ],
          [
            "insert into public.profiles (id, username) values ($1, $2)",
            [FUTURE_USER, "fake"],
          ],
          ["delete from public.profiles where id = $1", [ALICE]],
          [
            "update public.posts set id = $1 where id = $2",
            [FUTURE_USER, postId],
          ],
          [
            "update public.posts set author_id = $1 where id = $2",
            [BOB, postId],
          ],
          [
            "update public.posts set created_at = '2000-01-01' where id = $1",
            [postId],
          ],
          [
            "update public.posts set updated_at = '2000-01-01' where id = $1",
            [postId],
          ],
          [
            "insert into public.posts (id, author_id, content) values ($1, $2, $3)",
            [FUTURE_USER, ALICE, "x"],
          ],
          [
            "update public.comments set post_id = $1 where id = $2",
            [postId, commentId],
          ],
          [
            "update public.comments set author_id = $1 where id = $2",
            [BOB, commentId],
          ],
          [
            "update public.comments set id = $1 where id = $2",
            [FUTURE_USER, commentId],
          ],
          [
            "update public.comments set created_at = '2000-01-01' where id = $1",
            [commentId],
          ],
          [
            "update public.comments set updated_at = '2000-01-01' where id = $1",
            [commentId],
          ],
          [
            "insert into public.comments (id, post_id, author_id, content) values ($1, $2, $3, $4)",
            [FUTURE_USER, postId, ALICE, "x"],
          ],
        ] as const;
        for (const [sql, params] of deniedQueries) {
          await assert.rejects(
            () => db.query(sql, [...params]),
            { code: "42501" },
            sql,
          );
        }
      });
    });

    it("validates content length and rejects space/tab/newline-only posts and comments", async () => {
      const postId = await createPost();
      await asUser(ALICE, async () => {
        for (const content of ["", "   ", "\t\n\r", "x".repeat(5001)]) {
          await assert.rejects(
            () =>
              db.query(
                "insert into public.posts (author_id, content) values ($1, $2)",
                [ALICE, content],
              ),
            { code: "23514" },
          );
        }
        for (const content of ["", " \t\n", "x".repeat(2001)]) {
          await assert.rejects(
            () =>
              db.query(
                "insert into public.comments (post_id, author_id, content) values ($1, $2, $3)",
                [postId, ALICE, content],
              ),
            { code: "23514" },
          );
        }
        await db.query(
          "insert into public.posts (author_id, content) values ($1, $2)",
          [ALICE, "я".repeat(5000)],
        );
        await db.query(
          "insert into public.comments (post_id, author_id, content) values ($1, $2, $3)",
          [postId, ALICE, "я".repeat(2000)],
        );
      });
    });

    it("validates username, avatar URL, course, and profile field limits in PostgreSQL", async () => {
      await asUser(ALICE, async () => {
        const invalidFields: [string, string | number][] = [
          ["username", "ab"],
          ["username", "Uppercase"],
          ["username", "bad-name"],
          ["username", "edit"],
          ["username", "a".repeat(41)],
          ["first_name", "я".repeat(81)],
          ["last_name", "я".repeat(81)],
          ["bio", "я".repeat(301)],
          ["specialty", "я".repeat(121)],
          ["group_name", "я".repeat(41)],
          ["course", 0],
          ["course", 7],
          ["avatar_url", "http://example.com/photo.jpg"],
          ["avatar_url", "https://"],
          ["avatar_url", "https://example.com/with space"],
          ["avatar_url", `https://example.com/${"x".repeat(2048)}`],
        ];
        for (const [column, value] of invalidFields) {
          await assert.rejects(
            () =>
              db.query(
                `update public.profiles set ${column} = $1 where id = $2`,
                [value, ALICE],
              ),
            { code: "23514" },
            column,
          );
        }
      });
    });

    it("saves profile and interest replacement atomically through the invoker RPC", async () => {
      await asUser(ALICE, async () => {
        await saveProfile(" Alice ", [MUSIC, PROGRAMMING]);
        let result = await db.query<{
          username: string;
          first_name: string;
          bio: string;
          avatar_url: string | null;
        }>(
          "select username, first_name, bio, avatar_url from public.profiles where id = $1",
          [ALICE],
        );
        assert.deepEqual(result.rows[0], {
          username: "alice",
          first_name: "Алиса",
          bio: "О себе",
          avatar_url: null,
        });
        let interests = await db.query(
          "select * from public.profile_interests where profile_id = $1",
          [ALICE],
        );
        assert.equal(interests.rows.length, 2);
        await saveProfile("alice_updated", []);
        interests = await db.query(
          "select * from public.profile_interests where profile_id = $1",
          [ALICE],
        );
        result = await db.query(
          "select username, first_name, bio, avatar_url from public.profiles where id = $1",
          [ALICE],
        );
        assert.equal(interests.rows.length, 0);
        assert.equal(result.rows[0]?.username, "alice_updated");
      });
      const functionDetails = await db.query<{
        prosecdef: boolean;
        proconfig: string[];
      }>(
        "select prosecdef, proconfig from pg_proc where oid = 'public.update_my_profile(text,text,text,text,text,text,integer,text,uuid[])'::regprocedure",
      );
      assert.equal(functionDetails.rows[0]?.prosecdef, false);
      assert.ok(
        functionDetails.rows[0]?.proconfig.some((entry) =>
          entry.startsWith("search_path="),
        ),
      );
    });

    it("rolls back profile and interests on duplicate username or invalid interest input", async () => {
      await asUser(BOB, () => saveProfile("bob", [PROGRAMMING]));
      await asUser(ALICE, async () => {
        await saveProfile("alice", [MUSIC]);
        await assert.rejects(() => saveProfile("bob", [PROGRAMMING]), {
          code: "23505",
        });
        await assert.rejects(() => saveProfile("changed", [UNKNOWN_INTEREST]), {
          code: "22023",
        });
        await assert.rejects(() => saveProfile("changed", [MUSIC, MUSIC]), {
          code: "22023",
        });
        await assert.rejects(() => saveProfile("changed", [null]), {
          code: "22023",
        });
        await assert.rejects(
          () => saveProfile("changed", Array<string>(11).fill(MUSIC)),
          { code: "22023" },
        );
        const profile = await db.query<{ username: string }>(
          "select username from public.profiles where id = $1",
          [ALICE],
        );
        const interests = await db.query<{ interest_id: string }>(
          "select interest_id from public.profile_interests where profile_id = $1",
          [ALICE],
        );
        assert.equal(profile.rows[0]?.username, "alice");
        assert.deepEqual(interests.rows, [{ interest_id: MUSIC }]);
      });
    });

    it("rolls back a profile update when a later interest insert fails", async () => {
      await asUser(ALICE, () => saveProfile("alice", [MUSIC]));
      // Inject a downstream constraint failure, exercising actual transactional
      // rollback after the UPDATE and DELETE inside the RPC have already run.
      await db.exec(`create function public.test_reject_interest() returns trigger language plpgsql as $$
      begin raise exception 'Simulated downstream failure' using errcode = '23514'; end;
      $$;
      create trigger test_reject_interest before insert on public.profile_interests
      for each row execute function public.test_reject_interest();`);
      try {
        await asUser(ALICE, async () => {
          await assert.rejects(() => saveProfile("changed", [PROGRAMMING]), {
            code: "23514",
          });
          const profile = await db.query<{ username: string }>(
            "select username from public.profiles where id = $1",
            [ALICE],
          );
          const interests = await db.query<{ interest_id: string }>(
            "select interest_id from public.profile_interests where profile_id = $1",
            [ALICE],
          );
          assert.equal(profile.rows[0]?.username, "alice");
          assert.deepEqual(interests.rows, [{ interest_id: MUSIC }]);
        });
      } finally {
        await db.exec(
          "drop trigger test_reject_interest on public.profile_interests; drop function public.test_reject_interest();",
        );
      }
    });

    it("keeps the interest catalog and trigger functions read-only to API users", async () => {
      await asUser(ALICE, async () => {
        await assert.rejects(
          () =>
            db.query(
              "insert into public.interests (slug, name) values ('hacked', 'Hacked')",
            ),
          { code: "42501" },
        );
        await assert.rejects(
          () =>
            db.query(
              "update public.interests set name = 'Hacked' where id = $1",
              [MUSIC],
            ),
          { code: "42501" },
        );
        await assert.rejects(
          () => db.query("delete from public.interests where id = $1", [MUSIC]),
          { code: "42501" },
        );
        await assert.rejects(
          () => db.query("select public.handle_new_user()"),
          { code: "42501" },
        );
        await assert.rejects(() => db.query("select public.set_updated_at()"), {
          code: "42501",
        });
      });
    });

    it("cascades dependent comments when a post is deleted by its owner", async () => {
      const postId = await createPost();
      await createComment(postId);
      await asUser(ALICE, () =>
        db.query("delete from public.posts where id = $1", [postId]),
      );
      const comments = await db.query(
        "select * from public.comments where post_id = $1",
        [postId],
      );
      assert.equal(comments.rows.length, 0);
    });

    it("cascades profiles, authored content, and interests when Auth deletes a user", async () => {
      const postId = await createPost();
      await createComment(postId);
      await asUser(ALICE, () => saveProfile("alice", [MUSIC]));
      await db.query("delete from auth.users where id = $1", [ALICE]);
      for (const [table, column] of [
        ["profiles", "id"],
        ["posts", "author_id"],
        ["profile_interests", "profile_id"],
      ] as const) {
        const result = await db.query(
          `select * from public.${table} where ${column} = $1`,
          [ALICE],
        );
        assert.equal(result.rows.length, 0);
      }
      const comments = await db.query(
        "select * from public.comments where post_id = $1",
        [postId],
      );
      assert.equal(comments.rows.length, 0);
    });
  },
);
