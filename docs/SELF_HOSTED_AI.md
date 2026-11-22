# NEXUS AI: подготовка отдельного сервера

## Статус и ресурсы

Сервера пока нет. Подготовлены интеграция и конфигурация; развёртывание 24/7, скорость реальной модели, Docker/NVIDIA, DNS и TLS **не проверены**. Текущий production не переключать до прохождения проверок ниже. Никакие серверы не заказаны.

`gpt-oss:20b` — открытые веса OpenAI, не копия сервиса ChatGPT. Официальное руководство рекомендует от 16 GB VRAM или объединённой памяти; это не гарантия достаточности для публичного сервера. Запас для контекста и процессов нужен отдельно. [Источник OpenAI](https://developers.openai.com/cookbook/articles/gpt-oss/run-locally-ollama).

Начальная конфигурация для проверки: Linux x86_64, NVIDIA с **24 GB VRAM**, **32 GB RAM**, 8 vCPU и **60 GB SSD**, публичный IPv4 и DNS-имя под вашим управлением. Это оценка, не измерение производительности. CPU-only не выбран для публичного MVP: задержка и соблюдение 50-секундного deadline неизвестны. Compose ограничивает Ollama 26 GB RAM/8 CPU, gateway 512 MB/1 CPU, Caddy 256 MB/0.5 CPU. Лимит VRAM задаётся доступной картой, Docker RAM-limit её не ограничивает.

Одновременно выполняется **одна** генерация; очереди gateway нет, остальные получают `429`/`Retry-After: 5`. Окно 16384 токена, до 1200 выходных токенов, deadline 50 секунд. До запуска нужно измерить первый токен/полный ответ на русском при холодной и прогретой модели. Если выбранный сервер не укладывается — менять ресурсы или отдельно согласовать другую локальную модель, без скрытого fallback.

Веса не означают бесплатную эксплуатацию. Пример цены на 22.10.2026: Runpod указывает RTX 4090 (24 GB VRAM/41 GB RAM) $0.89/час, около **$649.70 за 730 часов**, без диска, налогов и сетевых доплат. Это ориентир, не заказ и не гарантия доступности; перед покупкой проверить окончательную цену, сохранение данных и работу 24/7. [Официальный прайс](https://www.runpod.io/pricing). Отдельно оплачиваются постоянный диск, IP/трафик и DNS-имя, если они не включены.

## Границы системы

`Vercel /api/ai → HTTPS Caddy → gateway:8080 → ollama:11434 → локальные веса`.

- Браузер не получает токен gateway и не обращается к Ollama. Авторизацию пользователя, согласие и постоянные квоты проверяет существующий backend NEXUS.
- На host опубликованы только TCP 80/443 Caddy. Порты 8080 и 11434 не публикуются; Docker socket не монтируется. SSH разрешать только своим адресам. Ограничения облачного firewall должны быть на уровне провайдера, поскольку Docker port publishing может обходить обычные правила UFW.
- `OLLAMA_NO_CLOUD=1` отключает облачные функции; gateway принимает только точный `AI_MODEL`, запрещает cloud-ID и не имеет fallback. [Официальное описание](https://github.com/ollama/ollama/blob/main/docs/faq.mdx), [реализация переменной](https://github.com/ollama/ollama/blob/main/envconfig/config.go).
- Docker bridge даёт исходящий доступ для загрузки весов. После pull можно отдельно запретить исходящие подключения контейнера Ollama средствами firewall провайдера/хоста; Compose не выдаёт это за реализованную egress-изоляцию. Caddy нужен исходящий HTTPS для сертификатов.
- Gateway не сохраняет историю или тела запросов и пишет только технические коды ошибок. Caddy access-log выключен, debug Ollama выключен. Логи контейнеров ограничены 3 × 5 MB на сервис. Не включать debug или дампы HTTP-тел в production.
- `restart: unless-stopped` запускает контейнеры после сбоя/перезагрузки Docker. Healthcheck отмечает unhealthy, но сам по себе не перезапускает живой зависший процесс; это не гарантия бесперебойности. Проверять `/healthz` внешним мониторингом после запуска.

## 1. Установка на сервере

База: Ubuntu 24.04 x86_64 с установленным совместимым драйвером NVIDIA. Сначала `nvidia-smi` должен успешно показывать выбранную карту. Драйвер устанавливается по инструкции выбранного GPU-провайдера; его версия здесь не выдумывается.

Выполнить от пользователя с sudo. Команды подключения репозиториев основаны на [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/) и [Ollama NVIDIA Container Toolkit](https://docs.ollama.com/docker); перед запуском сверить поддержку вашей ОС.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git python3
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' "Types: deb" "URIs: https://download.docker.com/linux/ubuntu" "Suites: $VERSION_CODENAME" "Components: stable" "Architectures: $(dpkg --print-architecture)" "Signed-By: /etc/apt/keyrings/docker.asc" | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl enable --now docker
sudo systemctl restart docker
sudo docker compose version
nvidia-smi
```

Далее все `docker` команды показаны с sudo. Добавление пользователя в группу docker предоставляет административные права и не требуется.

## 2. Конфигурация и DNS

Создать DNS A-запись выбранного имени (например, `ai.ваш-домен`) на IPv4 сервера. AAAA создавать только при реально настроенном IPv6. Разрешить входящие TCP 80/443; TLS Caddy выпустит автоматически. Не открывать 11434/8080. Использовать обычную DNS-запись без дополнительного HTTP-прокси на первом запуске.

```sh
git clone --branch feature/self-hosted-ai https://github.com/aliveytty-gif/nexus.git
cd nexus
git rev-parse HEAD
cd infra/ai
cp .env.example .env
chmod 600 .env
```

Записать выведенный commit SHA; для повторного развёртывания использовать `git checkout <сохранённый-SHA>`. После объединения PR код также будет доступен в `main`.

Образы фиксируются по digest на самом сервере: теги используются только для первоначального разрешения в неизменяемый digest. Следующая команда загружает официальные образы, запрашивает DNS/email, генерирует случайный 256-bit токен и записывает `.env`, **не печатая токен**. Сохранить его в менеджере паролей для Vercel; `.env` не коммитить и не отправлять в чат.

```sh
sudo python3 - <<'PY'
import os, re, secrets, subprocess
from pathlib import Path
with open('/dev/tty', 'r+') as tty:
    tty.write('DNS hostname: '); tty.flush()
    hostname = tty.readline().strip()
    tty.write('ACME contact email: '); tty.flush()
    email = tty.readline().strip()
if not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', hostname) or '.' not in hostname:
    raise SystemExit('Invalid DNS hostname')
if not re.fullmatch(r'[^\s{}@]+@[^\s{}@]+\.[^\s{}@]+', email):
    raise SystemExit('Invalid email')
values = {'AI_DOMAIN': hostname, 'ACME_EMAIL': email, 'AI_GATEWAY_TOKEN': secrets.token_hex(32), 'AI_MODEL': 'gpt-oss:20b'}
for key, image in [('OLLAMA_IMAGE', 'ollama/ollama:latest'), ('NODE_IMAGE', 'node:22-alpine'), ('CADDY_IMAGE', 'caddy:2-alpine')]:
    subprocess.run(['docker', 'pull', image], check=True)
    digest = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', image], text=True).strip()
    if '@sha256:' not in digest: raise SystemExit('Missing immutable image digest')
    values[key] = digest
Path('.env').write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
os.chmod('.env', 0o600)
PY
sudo docker compose config --quiet
```

`config --quiet` не печатает секреты. Обычный `docker compose config`, `docker inspect` и `printenv` могут их вывести — не копировать такой вывод в чат/PR.

## 3. Локальные веса, прогрев, запуск HTTPS

```sh
sudo docker compose up -d ollama
sudo docker compose exec ollama ollama pull gpt-oss:20b
sudo docker compose exec ollama ollama list
sudo docker compose exec ollama ollama run gpt-oss:20b 'Ответь одним словом: привет'
sudo docker compose exec ollama ollama ps
sudo docker compose up -d --build
sudo docker compose ps
```

Проверить точный model-ID в `ollama list` и фактическое размещение CPU/GPU в `ollama ps`; сервер обязан загружать локальные веса, вход в Ollama Cloud не нужен. Прогрев не является benchmark. После загрузки весов gateway healthcheck проверяет `/api/tags`, не запускает генерацию; `ready=true` означает наличие модели и доступность Ollama, а не гарантию свободного GPU/быстрого ответа. [Контекст и GPU в Ollama](https://docs.ollama.com/faq).

## 4. Проверка gateway

Без авторизации запрос `https://ваше-имя/healthz` должен вернуть **401**. Для проверки с токеном, не помещая его в аргументы процесса, shell history или лог, выполнить из `infra/ai`:

```sh
sudo python3 - <<'PY'
import json, urllib.request
from pathlib import Path
values = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines() if line and not line.startswith('#'))
base = 'https://' + values['AI_DOMAIN']
headers = {'Authorization': 'Bearer ' + values['AI_GATEWAY_TOKEN'], 'Content-Type': 'application/json'}
with urllib.request.urlopen(urllib.request.Request(base + '/healthz', headers=headers), timeout=10) as response:
    print(response.status, response.read().decode())
payload = {'model': values['AI_MODEL'], 'messages': [{'role': 'system', 'content': 'Ты помощник NEXUS. Отвечай по-русски.'}, {'role': 'user', 'content': 'Объясни переменную в программировании двумя предложениями.'}], 'maxOutputTokens': 400}
request = urllib.request.Request(base + '/v1/chat', headers=headers, data=json.dumps(payload).encode())
with urllib.request.urlopen(request, timeout=55) as response:
    for line in response: print(line.decode().rstrip(), flush=True)
PY
```

Ожидаются несколько `{"type":"delta","text":"…"}` и финальный `{"type":"done"}`; задержки зависят от сервера. `error` не считать успешным ответом. Проверить отмену во время длинного ответа, повтор после отмены, параллельный запрос (`429`) и исчезновение сетевого соединения. Закрытие downstream abort-ит upstream HTTP; фактическую остановку GPU нужно дополнительно наблюдать на реальном Ollama.

## 5. Подключение Vercel только после готовности сервера

В существующем проекте `nexus` → Settings → Environment Variables установить **server-only** переменные нужного окружения:

```env
AI_ENABLED=true
AI_PROVIDER=ollama
AI_MODEL=gpt-oss:20b
AI_GATEWAY_URL=https://ваше-DNS-имя
AI_GATEWAY_TOKEN=секрет-из-серверного-.env
AI_STREAMING=true
AI_MAX_OUTPUT_TOKENS=400
```

Свои системные инструкции можно добавить серверной переменной `AI_SYSTEM_INSTRUCTIONS` (до 2000 символов); базовая личность помощника сохраняется. Не передавать туда секреты или данные других пользователей.

Не использовать префикс `NEXT_PUBLIC_` для токена/настроек сервера. `AI_GATEWAY_URL` — origin без `/v1/chat`. `OLLAMA_BASE_URL` используется только внутри Docker gateway (`http://ollama:11434`); Next.js к Ollama напрямую не обращается. Для development Next.js использует `AI_GATEWAY_URL` на loopback-адрес защищённого gateway с тем же токеном; для Vercel требуется HTTPS DNS-имя. Удалять старый ключ OpenRouter можно после успешного перехода; `AI_PROVIDER=ollama` не обращается к нему и не переключается на него автоматически.

Сначала Preview → проверить авторизованный `/ai`: русский ответ появляется постепенно, повторный вопрос учитывает предыдущую пару, «Остановить» прерывает, при сетевой ошибке возможен повтор; вход/согласие и квоты сохраняются. Проверить другой аккаунт, anonymous `401`, несовпадающий Origin `403`, отсутствие тела токена в браузере. История AI остаётся только в памяти текущего чата, новая БД истории не создаётся; чужую историю получать неоткуда. Затем выпуск через PR/проверку build и production redeploy; проверить постоянную [production-страницу](https://nexus-chi-khaki-43.vercel.app/ai). Отключение сервера должно показывать понятную недоступность, без платного fallback.

Если переход требуется отменить — `AI_ENABLED=false` и redeploy выключат AI; остальная социальная сеть продолжает работать. Возврат OpenRouter только явным решением владельца, не автоматический.

## Обслуживание

- **Остановка:** `sudo docker compose stop`. **Запуск:** `sudo docker compose up -d`. `down -v` удаляет веса и сертификаты — не использовать для обычной остановки.
- **Статус:** `sudo docker compose ps`, `sudo docker compose logs --tail=50 gateway`, `sudo docker compose exec ollama ollama ps`. Не публиковать необработанные логи, если позже менялась конфигурация logging.
- **Резервная копия:** остановить стек; сохранить зашифрованную `.env`, точный commit, Caddyfile и volumes `nexus-ai_ollama`, `nexus-ai_caddy-data`, `nexus-ai_caddy-config` средствами snapshot/backup провайдера. Веса можно скачать заново, сертификаты и секрет хранить закрыто. AI-диалоги в volumes не сохраняются. Проверить восстановление до того, как полагаться на backup.
- **Обновление:** сначала записать текущие digest/commit и сделать backup; отдельно разрешить новые официальные image digests, заменить соответствующие значения `.env`, `sudo docker compose build --pull gateway`, `sudo docker compose up -d`. Не запускать первоначальный генератор `.env` повторно: он сменит токен. После обновления повторить health/stream/cancel; при ошибке вернуть прежние digests/commit и `up -d --build`.
- **Модель:** только явная правка `AI_MODEL` на сервере и в Vercel, предварительный `ollama pull` точного local-ID, прогрев и отдельная оценка ресурсов. Никакого cloud-ID и незаметной замены. Для другой семьи модель может не поддерживать `think:false`; совместимость нужно проверить до переключения.
- **Известный предел:** один сервер и один gateway без HA, мониторинг и резервный GPU не настроены. Факт подготовки конфигурации не доказывает эксплуатацию 24/7.

## Автоматическая проверка без GPU

`node --experimental-strip-types --test tests/ai-gateway.test.ts` запускает настоящие локальные HTTP-соединения с подменённым Ollama: auth, exact-model health, границы входа/контекста, UTF-8 streaming, исключение thinking/tools, ошибки, deadline, disconnect и удержание единственного слота до завершения отменяемого fetch. Это не запуск весов, не Docker/NVIDIA/TLS и не production-тест сервера.
