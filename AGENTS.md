# Работа над NEXUS

- Сначала прочитайте `PROJECT_STATE.md` и только необходимые для задачи файлы.
- Используйте существующую архитектуру Next.js + Supabase. Минимальные изменения; без unrelated refactoring и пересоздания проекта.
- Не работайте непосредственно в `main`: создайте `feature/<short-name>` или `fix/<short-name>`, затем Pull Request с проверкой `build`.
- `main` представляет стабильный production. Preview не заменяет production до проверки и merge; новую миграцию применяйте отдельно до выпуска зависимого кода.
- Не коммитьте `.env.local`, credentials, secret/service_role keys, зависимости и сборки. `.env.example` содержит только публичные названия переменных и пустые значения.
- Проверяйте пользователя в каждом Server Action. Сохраняйте RLS; владелец определяется сессией. Личные вложения — только private Storage с доступом участников и signed URLs.
- Не меняйте применённые миграции; добавляйте новую, обновляйте типы и тесты прав.
- После завершения правок выполните typecheck, lint, связанные тесты и production build. Повторяйте только необходимые проверки после исправлений.
- После значимых функций кратко обновляйте `PROJECT_STATE.md`; отличайте проверенное от непроверенного.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
