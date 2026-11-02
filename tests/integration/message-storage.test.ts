import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Opt in explicitly. Never inherit the application's .env.local or use production fixtures.
test("real Supabase message-file privacy and group contact safety (A/B/C/anonymous)", {
  skip: process.env.NEXUS_STORAGE_TEST_RUN !== "1" ? "Isolated Storage test project not configured" : false,
  timeout: 240_000,
}, async (t) => {
  function required(name: string) {
    const value = process.env[name];
    assert.ok(value, `Missing ${name}`);
    return value;
  }
  const endpoint = new URL(required("NEXUS_STORAGE_TEST_URL"));
  const ref = required("NEXUS_STORAGE_TEST_PROJECT_REF");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, "", "Use a plain project URL");
  assert.ok(!endpoint.href.includes("dlvuhsbxchprpvxtnedz"), "NEXUS production is forbidden");
  assert.ok(local ? ref === "local" : endpoint.protocol === "https:" && /^[a-z0-9]+$/.test(ref)
    && ref !== "dlvuhsbxchprpvxtnedz" && endpoint.hostname === `${ref}.supabase.co`, "Explicit isolated project ref required");
  const url = endpoint.origin;
  const key = required("NEXUS_STORAGE_TEST_PUBLISHABLE_KEY");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  // Server-side test runner only; this key is never imported by application code.
  const admin = createClient(url, required("NEXUS_STORAGE_TEST_SERVICE_ROLE_KEY"), options);
  const anonymous = createClient(url, key, options);
  const users: { id: string; client: SupabaseClient }[] = [];
  const conversations: string[] = [];
  const objects: string[] = [];
  const bytes = new TextEncoder().encode("NEXUS isolated Storage permission fixture\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFwAAAABJRU5ErkJggg==", "base64");
  const bucket = (client: SupabaseClient) => client.storage.from("message-files");
  function succeeded(error: unknown, step: string) { assert.equal(Boolean(error), false, step); }
  async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    succeeded(error, `RPC ${name} failed (credentials and response deliberately omitted)`);
    return data;
  }
  function filePath(conversation: string, owner: string, filename: string) {
    return `${conversation}/${owner}/${randomUUID()}-${filename}`;
  }
  async function upload(client: SupabaseClient, path: string, data: Uint8Array, type: string) {
    objects.push(path); // Also clean up an upload with an ambiguous network outcome.
    const { error } = await bucket(client).upload(path, data, { contentType: type, upsert: false, cacheControl: "0" });
    succeeded(error, "Fixture upload failed");
  }
  async function visible(client: SupabaseClient, path: string, allowed: boolean, expected = bytes) {
    const { data, error } = await bucket(client).download(path);
    assert.equal(!error && data !== null, allowed, "Unexpected authenticated download permission");
    if (allowed && data) assert.deepEqual(new Uint8Array(await data.arrayBuffer()), new Uint8Array(expected), "Downloaded bytes changed");
    const { data: info, error: infoError } = await bucket(client).info(path);
    assert.equal(!infoError && info !== null, allowed, "Unexpected metadata permission");
    const { data: signed, error: signError } = await bucket(client).createSignedUrl(path, 60);
    assert.equal(!signError && Boolean(signed?.signedUrl), allowed, "Unexpected signed URL creation permission");
    const parts = path.split("/");
    const { data: listed, error: listError } = await bucket(client).list(parts.slice(0, 2).join("/"), { limit: 100 });
    assert.equal(!listError && Boolean(listed?.some((entry) => entry.name === parts[2])), allowed,
      "Unexpected Storage listing permission");
  }
  async function publish(client: SupabaseClient, conversation: string, sender: string, path: string, legacy = false) {
    const name = path.split("/").at(-1)!.slice(37);
    const attachment = { path, name, type: "text/plain", size: bytes.byteLength };
    const fields = legacy ? { attachment_path: path, attachment_name: name, attachment_type: attachment.type,
      attachment_size: attachment.size } : { attachments: [attachment] };
    const { error } = await client.from("messages").insert({ conversation_id: conversation, sender_id: sender, body: "", ...fields });
    succeeded(error, "Fixture message insert failed");
  }

  try {
    for (let index = 0; index < 3; index++) {
      const email = `nexus-storage-${randomUUID()}@example.com`;
      const password = `${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      succeeded(error, "Creating isolated test user failed");
      assert.ok(data.user, "Test user missing");
      const client = createClient(url, key, options);
      users.push({ id: data.user.id, client });
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      succeeded(signInError, "Test sign-in failed");
    }
    const [a, b, c] = users;
    const direct = await rpc(a.client, "get_or_create_direct_conversation", { p_other_user_id: b.id }) as string;
    conversations.push(direct);
    const pending = filePath(direct, a.id, "pending.txt");

    await t.test("pending: A reads bytes; B/C/anonymous cannot list, download, inspect or sign", async () => {
      await upload(a.client, pending, bytes, "text/plain");
      await visible(a.client, pending, true);
      for (const client of [b.client, c.client, anonymous]) await visible(client, pending, false);
      const { data } = bucket(anonymous).getPublicUrl(pending);
      const response = await fetch(data.publicUrl);
      assert.equal(response.ok, false, "Private bucket must not serve a public URL");
      await response.body?.cancel();
    });
    await t.test("recipient cannot publish or delete the owner's draft", async () => {
      const { error } = await b.client.from("messages").insert({ conversation_id: direct, sender_id: b.id, body: "",
        attachments: [{ path: pending, name: "pending.txt", type: "text/plain", size: bytes.byteLength }] });
      assert.equal(Boolean(error), true, "Recipient published another user's draft");
      await bucket(b.client).remove([pending]); // Some Storage versions return an empty successful removal.
      await visible(a.client, pending, true);
    });
    await t.test("sent array attachment: B reads exact bytes; C/anonymous remain denied", async () => {
      await publish(a.client, direct, a.id, pending);
      await visible(b.client, pending, true);
      for (const client of [c.client, anonymous]) await visible(client, pending, false);
    });
    await t.test("legacy single-file message remains readable", async () => {
      const path = filePath(direct, a.id, "legacy.txt");
      await upload(a.client, path, bytes, "text/plain");
      await publish(a.client, direct, a.id, path, true);
      await visible(b.client, path, true);
    });
    await t.test("cancelled and abandoned drafts never become visible to B", async () => {
      const cancelled = filePath(direct, a.id, "cancelled.txt");
      const abandoned = filePath(direct, a.id, "abandoned.txt");
      for (const path of [cancelled, abandoned]) await upload(a.client, path, bytes, "text/plain");
      const { error } = await bucket(a.client).remove([cancelled]);
      succeeded(error, "Owner cancellation failed");
      await visible(a.client, cancelled, false);
      await visible(a.client, abandoned, true);
      for (const path of [cancelled, abandoned]) await visible(b.client, path, false);
    });
    await t.test("avatar publication and removal respect membership; old signed URLs are bearer links", async () => {
      const group = await rpc(a.client, "create_group_conversation", { p_title: "Isolated Storage test", p_member_ids: [b.id] }) as string;
      conversations.push(group);
      const path = filePath(group, a.id, "avatar.png");
      await upload(a.client, path, png, "image/png");
      await visible(b.client, path, false);
      await rpc(a.client, "update_group_conversation", { p_conversation_id: group, p_title: "Isolated Storage test", p_avatar_path: path });
      await visible(b.client, path, true, png);
      await visible(c.client, path, false);
      const { data: signed, error } = await bucket(b.client).createSignedUrl(path, 60);
      succeeded(error, "Signing published avatar failed");
      assert.ok(signed?.signedUrl, "Signed URL missing");
      await rpc(a.client, "manage_group_member", { p_conversation_id: group, p_user_id: b.id, p_action: "remove" });
      const { error: freshSignError } = await bucket(b.client).createSignedUrl(path, 60);
      assert.equal(Boolean(freshSignError), true, "Removed member obtained a fresh signed URL");
      const { data: listed } = await bucket(b.client).list(`${group}/${a.id}`);
      assert.equal(Boolean(listed?.some((entry) => entry.name === path.split("/").at(-1))), false);
      // Bust the direct-download cache; previously cached responses are a separate limitation.
      const { data: session } = await b.client.auth.getSession();
      const response = await fetch(`${url}/storage/v1/object/authenticated/message-files/${path}?test=${randomUUID()}`, {
        headers: { apikey: key, Authorization: `Bearer ${session.session!.access_token}`, "Cache-Control": "no-cache" },
      });
      assert.equal(response.ok, false, "Removed member downloaded through the authenticated endpoint");
      await response.body?.cancel();
      const bearerResponse = await fetch(signed.signedUrl);
      assert.equal(bearerResponse.ok, true, "Already issued signed URL should not be treated as revoked by membership change");
      assert.deepEqual(new Uint8Array(await bearerResponse.arrayBuffer()), new Uint8Array(png));
    });
    await t.test("group admission rejects either block direction, including third-party grouping and admin additions", async () => {
      const group = await rpc(a.client, "create_group_conversation", { p_title: "Contact safety fixture", p_member_ids: [b.id] }) as string;
      conversations.push(group);
      await rpc(a.client, "manage_group_member", { p_conversation_id: group, p_user_id: b.id, p_action: "promote" });
      for (const [blocker, target] of [[b, c], [c, b]]) {
        await rpc(blocker.client, "set_user_block", { p_user_id: target.id, p_blocked: true });
        try {
          const created = await a.client.rpc("create_group_conversation", { p_title: "Blocked fixture", p_member_ids: [b.id, c.id] });
          if (typeof created.data === "string") conversations.push(created.data);
          assert.equal(created.error?.code, "42501", "Third party grouped blocked participants");
          for (const manager of [a, b]) {
            const { error } = await manager.client.rpc("manage_group_member", {
              p_conversation_id: group, p_user_id: c.id, p_action: "add",
            });
            assert.equal(error?.code, "42501", "Creator/admin bypassed another member's block");
          }
          const { data, error } = await a.client.from("conversation_members").select("user_id").eq("conversation_id", group);
          succeeded(error, "Reading fixture membership failed");
          assert.equal(data?.length, 2, "Rejected addition left a partial membership");
        } finally { await rpc(blocker.client, "set_user_block", { p_user_id: target.id, p_blocked: false }); }
      }
      await rpc(b.client, "manage_group_member", { p_conversation_id: group, p_user_id: c.id, p_action: "add" });
      const denied = await anonymous.rpc("create_group_conversation", { p_title: "Anonymous fixture", p_member_ids: [a.id, b.id] });
      assert.ok(denied.error, "Anonymous group creation was allowed");
      const internal = await a.client.rpc("lock_contact_users", { p_user_ids: [a.id, b.id] });
      assert.ok(internal.error, "Internal locks must not be client callable");
    });
    await t.test("racing group creation or admission with a block preserves subsequent contact denial", async () => {
      const [creation, blocking] = await Promise.all([
        a.client.rpc("create_group_conversation", { p_title: "Racing creation fixture", p_member_ids: [b.id, c.id] }),
        b.client.rpc("set_user_block", { p_user_id: c.id, p_blocked: true }),
      ]);
      if (typeof creation.data === "string") conversations.push(creation.data);
      succeeded(blocking.error, "Concurrent block failed");
      // Admission may linearize before blocking; an already-created group is retained.
      assert.ok(!creation.error || creation.error.code === "42501", "Unexpected concurrent creation failure");
      try {
        const later = await a.client.rpc("create_group_conversation", { p_title: "Later creation fixture", p_member_ids: [b.id, c.id] });
        if (typeof later.data === "string") conversations.push(later.data);
        assert.equal(later.error?.code, "42501", "Completed block did not prevent later third-party creation");
      } finally { await rpc(b.client, "set_user_block", { p_user_id: c.id, p_blocked: false }); }
      const group = await rpc(a.client, "create_group_conversation", { p_title: "Racing admission fixture", p_member_ids: [b.id] }) as string;
      conversations.push(group);
      const [addition, nextBlock] = await Promise.all([
        a.client.rpc("manage_group_member", { p_conversation_id: group, p_user_id: c.id, p_action: "add" }),
        b.client.rpc("set_user_block", { p_user_id: c.id, p_blocked: true }),
      ]);
      succeeded(nextBlock.error, "Concurrent member block failed");
      assert.ok(!addition.error || addition.error.code === "42501", "Unexpected concurrent admission failure");
      try {
        const later = await a.client.rpc("manage_group_member", { p_conversation_id: group, p_user_id: c.id, p_action: "add" });
        assert.equal(later.error?.code, "42501", "Completed block did not prevent later admission");
      } finally { await rpc(b.client, "set_user_block", { p_user_id: c.id, p_blocked: false }); }
    });
    await t.test("concurrent additions cannot admit a blocked pair; existing history survives later blocks", async () => {
      await rpc(b.client, "set_user_block", { p_user_id: c.id, p_blocked: true });
      try {
        const group = await rpc(a.client, "create_group_conversation", { p_title: "Concurrent contact fixture", p_member_ids: [b.id] }) as string;
        conversations.push(group);
        const { error: messageError } = await a.client.from("messages").insert({ conversation_id: group, sender_id: a.id, body: "Contact safety fixture" });
        succeeded(messageError, "Creating history fixture failed");
        await rpc(a.client, "manage_group_member", { p_conversation_id: group, p_user_id: b.id, p_action: "remove" });
        const additions = await Promise.all([b, c].map((member) => a.client.rpc("manage_group_member", {
          p_conversation_id: group, p_user_id: member.id, p_action: "add",
        })));
        assert.equal(additions.filter((result) => !result.error).length, 1, "Concurrent blocked pair was admitted or both additions failed");
        assert.equal(additions.filter((result) => result.error?.code === "42501").length, 1, "Missing atomic contact rejection");
        const { data, error } = await a.client.from("conversation_members").select("user_id").eq("conversation_id", group);
        succeeded(error, "Reading concurrent membership failed");
        assert.equal(data?.length, 2, "Concurrent additions left unexpected membership");
        const admitted = data?.find((member) => member.user_id !== a.id)?.user_id;
        const member = [b, c].find((candidate) => candidate.id === admitted);
        assert.ok(member, "Admitted fixture member missing");
        await rpc(member.client, "set_user_block", { p_user_id: a.id, p_blocked: true });
        try {
          const history = await member.client.from("messages").select("id").eq("conversation_id", group);
          succeeded(history.error, "Existing group history became inaccessible");
          assert.equal(history.data?.length, 1);
          const repeated = await a.client.rpc("manage_group_member", { p_conversation_id: group, p_user_id: member.id, p_action: "add" });
          assert.equal(repeated.error?.code, "42501", "Repeat addition bypassed block");
          await rpc(a.client, "manage_group_member", { p_conversation_id: group, p_user_id: member.id, p_action: "remove" });
        } finally { await rpc(member.client, "set_user_block", { p_user_id: a.id, p_blocked: false }); }
      } finally { await rpc(b.client, "set_user_block", { p_user_id: c.id, p_blocked: false }); }
    });
  } finally {
    // Delete only this run's exact paths/IDs. No bucket-wide or user-wide cleanup.
    let cleanupFailed = false;
    if (objects.length) {
      try { cleanupFailed = Boolean((await bucket(admin).remove(objects)).error); } catch { cleanupFailed = true; }
    }
    if (conversations.length) {
      try { cleanupFailed = Boolean((await admin.from("conversations").delete().in("id", conversations)).error) || cleanupFailed; }
      catch { cleanupFailed = true; }
    }
    for (const { id } of users) {
      try { cleanupFailed = Boolean((await admin.auth.admin.deleteUser(id)).error) || cleanupFailed; }
      catch { cleanupFailed = true; }
    }
    assert.equal(cleanupFailed, false, "Isolated fixture cleanup failed; inspect only this run's test fixtures");
  }
});
