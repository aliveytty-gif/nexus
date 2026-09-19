import { expect, test } from "@playwright/test";

test("landing introduces the community and account links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/NEXUS/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Большой колледж.Близкие люди.",
  );
  const accounts = page.getByRole("navigation", { name: "Аккаунт" });
  await expect(
    accounts.getByRole("link", { name: "Войти", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(
    accounts.getByRole("link", { name: "Регистрация", exact: true }),
  ).toHaveAttribute("href", "/register");
  await expect(
    page.getByRole("region", { name: "Возможности платформы" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("account links navigate between the real login and registration forms", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Аккаунт" })
    .getByRole("link", { name: "Войти", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "С возвращением.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "type",
    "email",
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );

  await page.getByRole("link", { name: "Присоединиться", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByRole("heading", { name: "Здесь свои.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Имя", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Фамилия", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("unconfigured app explains setup and disables account submission", async ({
  page,
}) => {
  await page.goto("/login");
  const submit = page.getByRole("button", {
    name: "Войти в NEXUS",
    exact: true,
  });
  await expect(submit).toBeVisible();
  test.skip(
    await submit.isEnabled(),
    "Supabase is configured on this server; this case requires an unconfigured app.",
  );

  await expect(submit).toBeDisabled();
  await page
    .getByRole("link", { name: "Инструкция по настройке →", exact: true })
    .click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("heading", {
      name: "Подключите NEXUS к Supabase",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("pre")).toContainText("NEXT_PUBLIC_SUPABASE_URL");
  await expect(page.locator("pre")).toContainText(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  await page.goto("/register");
  await expect(
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toBeDisabled();
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/setup$/);
});

for (const path of [
  "/feed",
  "/profile/edit",
  "/profile/e2e_unknown_user",
  "/posts/00000000-0000-4000-8000-000000000000",
  "/messages",
  "/map",
  "/ai",
]) {
  test(`unauthenticated visitor cannot enter ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/(?:setup|login)(?:\?|$)/);
    const destination = new URL(page.url());
    if (destination.pathname === "/login") {
      await expect(
        page.getByRole("heading", { name: "С возвращением.", exact: true }),
      ).toBeVisible();
      expect(destination.searchParams.get("next")).toMatch(/^\/(?!\/)/);
    } else {
      await expect(
        page.getByRole("heading", {
          name: "Подключите NEXUS к Supabase",
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("navigation", { name: "Разделы NEXUS" }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Текст публикации", { exact: true }),
    ).toHaveCount(0);
  });
}

test("public pages fit a 390px mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/login", "/register", "/setup"]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const viewport = document.documentElement.clientWidth;
              return (
                Math.max(
                  document.documentElement.scrollWidth,
                  document.body.scrollWidth,
                ) - viewport
              );
            }),
          { message: `${path} should not scroll horizontally at 390px` },
        )
        .toBeLessThanOrEqual(1);
    });
  }
});
