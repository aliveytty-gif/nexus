# Работа над NEXUS

Перед изменениями прочитайте README.md, docs/ARCHITECTURE.md, docs/ROADMAP.md и docs/TESTING.md.

## Границы и устройство

- Это переносимый учебный MVP одного колледжа: Next.js App Router, TypeScript, React, Tailwind, Supabase Auth/PostgreSQL, npm.
- Исходники — `src/`; переиспользуемый UI — `components`; предметная логика — `features`; инфраструктура — `lib`; схема и политики — `supabase/migrations`.
- Сохраняйте простую архитектуру одного приложения. Не добавляйте сервисы, realtime, AI API, роли и инфраструктуру без отдельной задачи.
- `/messages`, `/map`, `/ai` остаются заглушками, пока задача прямо не требует реализации модуля.

## Инварианты безопасности и данных

- Проверяйте пользователя в каждом изменяющем Server Action. Владелец определяется сессией, а не полем формы.
- Сохраняйте RLS на всех пользовательских таблицах; добавляйте политики вместе с новыми сущностями.
- Не используйте `service_role`/secret key в приложении и не храните `.env.local` в Git/ZIP.
- Поля профиля и набор интересов сохраняйте атомарно через PostgreSQL RPC.
- Изменения БД оформляйте новой миграцией; обновляйте типы, запросы и проверки прав. Не переписывайте применённые миграции.
- Не выдавайте миграцию схемы за перенос Auth или пользовательских данных.
- Не подменяйте отсутствие Supabase демонстрационными данными или локальной имитацией успешной авторизации.
- Не вставляйте HTML из пользовательских текстов. Проверяйте redirect-пути и внешние URL.

## Готовность изменения

1. Реализуйте только запрошенный результат с понятными пустыми состояниями и ошибками.
2. Выполните `npm run typecheck`, `npm run lint`, относящиеся к изменению тесты и `npm run build`.
3. Проверьте затронутый сценарий в браузере; для Auth/данных нужна реальная тестовая интеграция.
4. Обновите документацию, если изменились команды, env, маршруты или схема.
5. Сообщите, что проверено, что не выполнялось и почему. Build не доказывает работу Auth; локальный PGlite не равен развёрнутому Supabase.
6. В передаваемом проекте сохраните lock-файл, `.env.example`, миграции и инструкции для Mac/Windows; исключите зависимости, сборки, credentials и отчёты тестов.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
