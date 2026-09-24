# NEXUS v0.2 — Closed Alpha MVP

Обновлено: 2026-09-24.

- **Аватар:** выбор JPG/JPEG/PNG/WEBP до 5 MB, прямая загрузка в Supabase Storage, сохранение `profiles.avatar_url`, немедленное обновление интерфейса.
- **Пост:** одно изображение с preview, сохранение `posts.image_url`, отображение в Feed и посте.
- **Сообщения:** «Написать» в чужом профиле, один диалог на пару пользователей, отправка/ответ, список диалогов и история. Обновление вручную, без Realtime.
- **БД:** единственная новая миграция `202609230001_closed_alpha.sql` применена через SQL Editor в `dlvuhsbxchprpvxtnedz`; получено `Success. No rows returned`. Добавлены conversations, conversation_members, messages, RLS и buckets avatars/post-media. Старую миграцию повторно не запускать. CLI migration history не синхронизирована.
- **Доступ:** переписку читают только участники; отправитель — текущий пользователь; файлы изменяются только в собственной папке. Изображения доступны по публичным URL.
- **Проверки:** TypeScript, lint, production build пройдены. Три целевых PGlite-теста проверили обмен сообщениями, отсутствие дублей, ограничения для постороннего пользователя и Storage. Проверки production URL resolver пройдены. PGlite не заменяет проверку реального Supabase через браузер.

## Deployment

Production URL пока отсутствует. Автоматический Vercel connector вернул `Tool deploy_to_vercel not found`; CLI не авторизован. Проект подготовлен: `.vercelignore`, публичные env, HTTPS production-domain fallback вместо localhost на Vercel.

На текущем Mac подготовлен `../../work/deploy-nexus-v02.command`: запускается через `bash`, выполняет Vercel login и production deploy. Берёт только `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` из игнорируемого `.env.local`, передаёт их сборке и приложению. `NEXT_PUBLIC_SITE_URL` с localhost не переносится; используется `VERCEL_PROJECT_PRODUCTION_URL`. Для повторных CLI-публикаций использовать тот же launcher. Основание параметров: [Vercel CLI deploy](https://vercel.com/docs/cli/deploy).

После публикации:
1. Взять постоянный Production URL в Vercel → Project → Domains.
2. В Supabase → Authentication → URL Configuration поставить этот адрес в Site URL; добавить `<URL>/auth/confirm`, `<URL>/auth/callback`, `<URL>/auth/callback?next=/profile/edit`. Сохранить существующие localhost Redirect URLs.
3. Проверить с двух аккаунтов: регистрация, подтверждение, вход/выход, аватар, пост с фото, сообщение и ответ.

## Known issues / непроверенное

- Публичная публикация и production Auth ещё не проверены: требуется вход владельца в Vercel.
- Полный браузерный сценарий v0.2 с двумя подтверждёнными аккаунтами ещё не выполнен.
- Выбранное фото незавершённого поста может остаться в Storage при закрытии страницы.
