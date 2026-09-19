import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../../src/types/database";

type ProfileSnapshot =
  Database["public"]["Functions"]["update_my_profile"]["Args"];
const liveVariables = [
  "NEXUS_E2E_EMAIL",
  "NEXUS_E2E_PASSWORD",
  "NEXUS_E2E_OTHER_EMAIL",
  "NEXUS_E2E_OTHER_PASSWORD",
];
const liveReady =
  process.env.NEXUS_E2E_LIVE === "1" &&
  liveVariables.every((name) => Boolean(process.env[name]));
const signupReady =
  process.env.NEXUS_E2E_SIGNUP === "1" &&
  Boolean(
    process.env.NEXUS_E2E_SIGNUP_EMAIL && process.env.NEXUS_E2E_SIGNUP_PASSWORD,
  );

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test setting: ${name}`);
  return value;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  const button = page.getByRole("button", {
    name: "Войти в NEXUS",
    exact: true,
  });
  await expect(
    button,
    "Configure the test Supabase project before running live tests",
  ).toBeEnabled();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await button.click();
  await expect(page).toHaveURL(/\/feed(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Студенческая лента", exact: true }),
  ).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed_out$/);
  await expect(page.getByRole("status")).toHaveText(
    "Вы вышли из аккаунта на этом устройстве.",
  );
}

async function readProfileSnapshot(page: Page): Promise<ProfileSnapshot> {
  const course = await page.getByLabel("Курс", { exact: true }).inputValue();
  const avatar = await page.getByLabel(/Ссылка на аватар/).inputValue();
  return {
    p_first_name: await page.getByLabel("Имя", { exact: true }).inputValue(),
    p_last_name: await page.getByLabel("Фамилия", { exact: true }).inputValue(),
    p_username: await page.getByLabel("Username", { exact: true }).inputValue(),
    p_avatar_url: avatar || null,
    p_bio: await page.getByLabel("О себе", { exact: true }).inputValue(),
    p_specialty: await page
      .getByLabel("Специальность", { exact: true })
      .inputValue(),
    p_course: course ? Number(course) : null,
    p_group_name: await page.getByLabel("Группа", { exact: true }).inputValue(),
    p_interest_ids: await page
      .locator('input[name="interests"]:checked')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
  };
}

// Cleanup uses the same public key and the author's own session, never service_role.
async function cleanUpAuthor(
  url: string,
  key: string,
  email: string,
  password: string,
  profile: ProfileSnapshot | undefined,
  postText: string,
) {
  const supabase = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user)
    throw new Error(
      "Live cleanup could not authenticate the dedicated author account.",
    );
  const failures: string[] = [];
  const deletion = await supabase
    .from("posts")
    .delete()
    .eq("author_id", data.user.id)
    .eq("content", postText);
  if (deletion.error)
    failures.push("could not delete the uniquely marked test post");
  if (profile) {
    const restore = await supabase.rpc("update_my_profile", profile);
    if (restore.error)
      failures.push(
        "could not restore the author's previous profile and interests",
      );
  }
  const signOut = await supabase.auth.signOut({ scope: "local" });
  if (signOut.error) failures.push("could not close the cleanup session");
  if (failures.length)
    throw new Error(
      `Live cleanup failed: ${failures.join("; ")}. Inspect the dedicated test project.`,
    );
}

// Auth form values and session traffic must not be saved to browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("live Supabase", () => {

  test("two real users complete profile, post, comment and logout flow", async ({
    page,
  }) => {
    test.skip(
      !liveReady,
      "Requires NEXUS_E2E_LIVE=1 and both dedicated users' email/password settings.",
    );
    test.setTimeout(180_000);
    const email = setting("NEXUS_E2E_EMAIL");
    const password = setting("NEXUS_E2E_PASSWORD");
    const otherEmail = setting("NEXUS_E2E_OTHER_EMAIL");
    const otherPassword = setting("NEXUS_E2E_OTHER_PASSWORD");
    if (email.toLowerCase() === otherEmail.toLowerCase())
      throw new Error(
        "Live scenario requires two different dedicated accounts.",
      );
    const supabaseUrl = setting("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      setting("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const marker = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `e2e_${marker}`;
    const group = `E2E-${marker.slice(0, 8)}`;
    const postText = `Проверка NEXUS: публикация ${marker}`;
    const commentText = `Проверка NEXUS: комментарий ${marker}`;
    let originalProfile: ProfileSnapshot | undefined;
    let writesStarted = false;

    try {
      await test.step("A signs in and saves a profile with an interest", async () => {
        await login(page, email, password);
        await page
          .getByRole("link", { name: "Заполнить профиль", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Больше о тебе.", exact: true }),
        ).toBeVisible();
        originalProfile = await readProfileSnapshot(page);
        await page.getByLabel("Имя", { exact: true }).fill("Тест");
        await page.getByLabel("Фамилия", { exact: true }).fill("Сообщества");
        await page.getByLabel("Username", { exact: true }).fill(username);
        await page.getByLabel(/Ссылка на аватар/).fill("");
        await page
          .getByLabel("О себе", { exact: true })
          .fill(`Автоматическая проверка профиля ${marker}`);
        await page
          .getByLabel("Специальность", { exact: true })
          .fill("Информационные системы");
        await page.getByLabel("Курс", { exact: true }).selectOption("2");
        await page.getByLabel("Группа", { exact: true }).fill(group);
        for (const checkbox of await page
          .getByRole("checkbox", { checked: true })
          .all())
          await checkbox.uncheck();
        const interest = page.getByRole("checkbox").first();
        await expect(
          interest,
          "The migration must populate the interests catalog",
        ).toBeVisible();
        const interestText = (
          await page.locator(".interest-option").first().innerText()
        ).trim();
        await interest.check();
        writesStarted = true;
        await page
          .getByRole("button", { name: "Сохранить профиль", exact: true })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/profile/${username}\\?saved=1$`),
        );
        await expect(page.getByRole("status")).toHaveText("Профиль сохранён.");
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Тест Сообщества", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(`@${username}`, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(`2 курс · ${group}`, { exact: true }),
        ).toBeVisible();
        await expect(
          page
            .locator(".profile-interests")
            .getByText(interestText, { exact: true }),
        ).toBeVisible();
      });

      let postPath = "";
      await test.step("A creates a post, reloads the session and signs out", async () => {
        await page
          .getByRole("link", { name: "В студенческую ленту", exact: true })
          .click();
        await page
          .getByLabel("Текст публикации", { exact: true })
          .fill(postText);
        await page
          .getByRole("button", { name: "Опубликовать", exact: true })
          .click();
        await expect(page.getByRole("status")).toHaveText(
          "Публикация добавлена в ленту.",
        );
        const article = page
          .getByRole("article")
          .filter({ has: page.getByText(postText, { exact: true }) });
        await expect(article).toBeVisible();
        const href = await article
          .getByRole("link", { name: "Открыть публикацию", exact: true })
          .getAttribute("href");
        if (!href || !/^\/posts\/[0-9a-f-]+$/.test(href))
          throw new Error("Created post has no valid detail link.");
        postPath = href;
        await page.reload();
        await expect(
          page.getByLabel("Текст публикации", { exact: true }),
        ).toBeVisible();
        await expect(article).toBeVisible();
        await logout(page);
      });

      await test.step("B opens the author's profile and adds then deletes a comment", async () => {
        await login(page, otherEmail, otherPassword);
        const article = page
          .getByRole("article")
          .filter({ has: page.getByText(postText, { exact: true }) });
        await expect(article).toBeVisible();
        await article
          .getByRole("link", { name: "Тест Сообщества", exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`/profile/${username}$`));
        await expect(
          page.getByRole("heading", { name: "Тест Сообщества", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Редактировать", exact: true }),
        ).toHaveCount(0);
        await page.goto(postPath);
        await expect(page.getByText(postText, { exact: true })).toBeVisible();
        await page
          .getByLabel("Твой комментарий", { exact: true })
          .fill(commentText);
        await page
          .getByRole("button", { name: "Отправить комментарий", exact: true })
          .click();
        const comment = page
          .getByRole("article")
          .filter({ has: page.getByText(commentText, { exact: true }) });
        await expect(comment).toBeVisible();
        await comment
          .getByRole("button", { name: "Удалить комментарий", exact: true })
          .click();
        await expect(comment).toHaveCount(0);
        await page.reload();
        await expect(page.getByText(commentText, { exact: true })).toHaveCount(
          0,
        );
      });

      await test.step("future modules remain explicit placeholders and logout protects private routes", async () => {
        for (const feature of [
          { link: /^Сообщения/, heading: "Сообщения" },
          { link: /^Карта/, heading: "Карта колледжа" },
          { link: /^NEXUS AI/, heading: "NEXUS AI" },
        ]) {
          await page
            .getByRole("navigation", { name: "Разделы NEXUS" })
            .getByRole("link", { name: feature.link })
            .click();
          await expect(
            page.getByRole("heading", { name: feature.heading, exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("Раздел находится в разработке", { exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("textbox")).toHaveCount(0);
        }
        await logout(page);
        for (const privatePath of ["/feed", postPath, `/profile/${username}`]) {
          await page.goto(privatePath);
          await expect(page).toHaveURL(/\/login\?next=/);
          await expect(
            page.getByLabel("Пароль", { exact: true }),
          ).toBeVisible();
        }
      });
    } finally {
      if (writesStarted)
        await cleanUpAuthor(
          supabaseUrl,
          supabaseKey,
          email,
          password,
          originalProfile,
          postText,
        );
    }
  });

  test("opt-in signup reaches a confirmation notice or a new profile session", async ({
    page,
  }) => {
    test.skip(
      !signupReady,
      "Requires NEXUS_E2E_SIGNUP=1 and a fresh dedicated signup email/password.",
    );
    await page.goto("/register");
    const button = page.getByRole("button", {
      name: "Создать аккаунт",
      exact: true,
    });
    await expect(
      button,
      "Configure Supabase before running the real signup request",
    ).toBeEnabled();
    await page.getByLabel("Имя", { exact: true }).fill("Тест");
    await page.getByLabel("Фамилия", { exact: true }).fill("Регистрации");
    await page
      .getByLabel("Email", { exact: true })
      .fill(setting("NEXUS_E2E_SIGNUP_EMAIL"));
    await page
      .getByLabel("Пароль", { exact: true })
      .fill(setting("NEXUS_E2E_SIGNUP_PASSWORD"));
    await button.click();

    const notice = page
      .getByRole("status")
      .filter({ hasText: "Если этот email доступен для регистрации" });
    await expect
      .poll(async () => {
        if (new URL(page.url()).pathname === "/profile/edit") return "profile";
        if (await notice.isVisible()) return "confirmation notice";
        return "pending";
      })
      .toMatch(/^(profile|confirmation notice)$/);
    if (new URL(page.url()).pathname === "/profile/edit") {
      await expect(
        page.getByRole("heading", { name: "Больше о тебе.", exact: true }),
      ).toBeVisible();
      await logout(page);
    } else {
      await expect(notice).toContainText("Проверьте почту");
    }
    // This test does not read a mailbox or prove delivery/verification of email.
  });
});
