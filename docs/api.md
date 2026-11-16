# API

Принцип: **интерфейс PWA работает через то же публичное API**, что и
интеграции. Поэтому любая функция приложения доступна извне.

- REST + JSON, префикс `/api/v1`, спецификация OpenAPI 3.1 по адресу
  `/api/v1/openapi.json` и Swagger UI по `/api/docs`.
- Авторизация: `Authorization: Bearer <token>`. Это либо токен пользователя,
  либо токен интеграции со scopes.
- Идемпотентность: для POST можно передать заголовок `Idempotency-Key`.
  События и сообщения идемпотентны по своему `id`.
- Пагинация курсорная: `?limit=50&cursor=...`.
- Upsert по внешнему ключу: `PUT /api/v1/trips/by-external-id/{external_id}`.
- Действия от имени пользователя: токен интеграции со scope `act_as` может
  передать `X-Act-As-User: <user id | ext:external_id>`. Например, чтобы
  отправить сообщение от имени диспетчера из 1С.

## Основные ресурсы

### Служебные
```
GET    /health                         # { status, instance_id, version } — без авторизации
GET    /client-config                  # { instance_id, public_key, mirrors[], min_client_version, signature }
GET/PUT /settings/mirrors              # admin: список зеркал с приоритетами
POST   /invites                        # admin: ссылка/QR для подключения водителя
```

### Пользователи
```
GET    /users
POST   /users
PUT    /users/by-external-id/{ext}
PATCH  /users/{id}
POST   /users/{id}/deactivate
```

### Справочники
```
GET/POST/PATCH  /stage-types
GET/POST/PATCH  /event-types
GET/POST/PATCH  /requirement-templates
GET/POST/PATCH  /requirement-rules
```

### Рейсы
```
GET    /trips?state=&driver_id=&tag=&from=&to=
POST   /trips                          # рейс вместе с этапами и требованиями одним запросом
PUT    /trips/by-external-id/{ext}     # upsert целиком
GET    /trips/{id}                     # рейс, этапы, требования, последние события
PATCH  /trips/{id}
POST   /trips/{id}/assign              # { driver_id }
POST   /trips/{id}/cancel

POST   /trips/{id}/stages              # добавить этап
PATCH  /stages/{id}
POST   /trips/{id}/stages/reorder
```

Пример создания рейса:
```json
POST /api/v1/trips
{
  "externalId": "1C-000123",
  "number": "R-2026-0451",
  "driver": { "externalId": "DRV-17" },
  "tags": ["reefer"],
  "vehicle": { "plate": "А123ВС 77" },
  "cargo": { "description": "Паллеты, бытовая химия", "weightKg": 18000, "pallets": 33 },
  "stages": [
    {
      "type": "loading",
      "place": { "externalId": "WH-NORTH" },
      "details": { "windowFrom": "2026-11-20T06:00:00Z", "windowTo": "2026-11-20T09:00:00Z" },
      "requirements": [
        { "kind": "info", "title": "Позвони Ашоту, он откроет ворота",
          "contact": { "name": "Ашот", "phone": "+7 900 000-00-00" }, "showAt": "arrived" },
        { "kind": "acknowledgement", "title": "Не грузить выше 2 ярусов",
          "showAt": "arrived", "beforePhase": "started" },
        { "kind": "photo", "title": "Фото крепления ремнями", "min": 2, "beforePhase": "departed" }
      ]
    },
    { "type": "export_clearance", "details": { "address": "МАПП Брест" } },
    { "type": "unloading", "details": { "address": "Warszawa, ul. Magazynowa 5", "timezone": "Europe/Warsaw" } }
  ]
}
```

Место (`place`) даёт адрес, координаты и часовой пояс; `details` этапа их
уточняет. К требованиям, пришедшим с этапом, сервер добавляет требования по
умолчанию для типа этапа (у погрузки — фото процесса, пломба, CMR; для
`#reefer` — ещё температура).

Транзиты между точками сервер вставляет сам (см.
[state-machine.md](state-machine.md)). Явно переданный этап с `kind: transit`
заменяет автоматический.

### События
```
GET    /trips/{id}/events
GET    /trips/{id}/available-events    # что можно выставить сейчас (для текущего пользователя)
POST   /trips/{id}/events              # { id, event_type, stage_id?, occurred_at, lat, lon, values, attachment_ids[] }
POST   /events/batch                   # пакетная отправка офлайн-очереди
```

Статус и фаза этапа, а также статус рейса в API только читаются: они
вычисляются из событий. Чтобы их изменить, нужно отправить событие. Недопустимое событие в онлайне
возвращает `409` с объяснением. Событие из офлайн-очереди (`/events/batch`)
встаёт на своё место по `occurred_at`, а если не вписывается в автомат,
сохраняется со статусом `conflict`.

### Места
```
GET    /places?query=
POST   /places
PUT    /places/by-external-id/{ext}
PATCH  /places/{id}                    # адрес, контакты, часы работы
```

### Требования этапа
Требования приходят вместе с этапом при создании рейса (см. пример выше) и
добавляются к требованиям по умолчанию для типа этапа.
```
GET    /stages/{id}/requirements       # с состоянием выполнения и доказательствами
POST   /stages/{id}/requirements       # добавить требование к этапу
PATCH  /stage-requirements/{id}        # изменить: растёт revision, водитель получает уведомление
POST   /stage-requirements/{id}/waive  # снять с причиной (диспетчер)
```

### Автоматы (для админки и интеграторов)
```
GET    /state-machines                 # описание автоматов состояний и фаз по профилям (из кода)
GET    /stage-types/{id}/map           # автомат типа этапа: события, роли, требования на переходах
POST   /simulate                       # прогнать рейс и список событий без сохранения
```

### Инциденты
```
GET    /incidents?state=open
POST   /incidents/{id}/acknowledge
POST   /incidents/{id}/resolve
```

### Чаты и сообщения
```
GET    /chats
POST   /chats                          # { kind: direct|group, member_ids[], title? }
POST   /chats/{id}/members
DELETE /chats/{id}/members/{user_id}
GET    /chats/{id}/messages?cursor=
POST   /chats/{id}/messages            # { id, kind, text, attachment_ids[] }
POST   /chats/{id}/read                # { last_read_message_id }
```

### Файлы
```
POST   /attachments                    # multipart, возвращает id
GET    /attachments/{id}               # скачать (проверка прав)
```

### Позиции (с внешних GPS-трекеров)
```
POST   /trips/{id}/positions           # [{ ts, lat, lon, speed? }]
```

## Realtime

`GET /api/v1/ws` поддерживает одно WebSocket-соединение на клиента. Сервер
присылает:
`message.created`, `message.read`, `event.created`, `trip.updated`,
`stage.updated`, `typing`.

## Вебхуки

На те же типы событий. Тело подписывается HMAC-SHA256 в заголовке
`X-Plobi-Signature`. При ошибке доставка повторяется с экспоненциальной
задержкой до 24 часов.
