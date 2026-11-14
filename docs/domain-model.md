# Модель данных

У каждой сущности есть `id` (UUID), `created_at`, `updated_at` и
необязательный `external_id`, то есть идентификатор во внешней системе
клиента. По `external_id` интеграция может делать upsert, не храня наши UUID.

Время хранится в UTC. У точек маршрута есть часовой пояс (`timezone`), чтобы
показывать местное время.

## Пользователи и роли

```
User
  id, external_id, login, name, phone, email, locale, timezone
  role: admin | dispatcher | driver | observer
  is_active
```

- **admin** — настройки, справочники, пользователи, интеграции.
- **dispatcher** — создаёт и ведёт рейсы, общается с водителями.
- **driver** — видит свои рейсы, выставляет события, общается в чатах.
- **observer** — только чтение (например, клиент-грузовладелец или менеджер).

## Справочники (настраиваются компанией)

Подробно механика описана в [state-machine.md](state-machine.md).

```
StageType                       # тип этапа: погрузка, таможня, порт, транзит по дороге...
  code, name{ru,en,...}, icon, color, is_system, sort
  kind: point | transit
  transit_mode?: road | ferry | rail     # только для kind = transit
  states[]                      # { code, name, category: pending|active|done|skipped, initial?: bool }
  transitions[]                 # { event_type, from[], to, requires_requirements?: bool }

EventType                       # тип события
  code, name{ru,en,...}, icon, color, is_system
  action: transition | info | incident_open | incident_close | system
  allowed_roles[]               # кто может выставлять: driver / dispatcher / ...
  stage_types[]                 # где доступно (для info и инцидентов; пусто = везде)
  fields[]                      # что нужно заполнить (см. ниже)
  incident_type?                # для incident_open / incident_close
  severity: info | warning | critical   # critical — сразу уведомить диспетчера

IncidentType                    # поломка, ДТП, повреждение груза...
  code, name, blocks_progress: bool, severity

RequirementType                 # шаблон требования этапа
  code, name, kind: checkbox | photo | document | signature | number | text | select
```

При сохранении справочника автомат проверяется: у этапа есть ровно одно
начальное состояние, из каждого состояния достижимо состояние категории
`done`, а все события в переходах существуют и имеют `action = transition`.

### Поля события (`fields`)

Описываются декларативно, интерфейс строит форму сам:

```json
[
  { "key": "photo",   "kind": "photo",  "required": true,  "min": 1, "max": 5 },
  { "key": "temp",    "kind": "number", "required": false, "unit": "°C" },
  { "key": "comment", "kind": "text",   "required": false },
  { "key": "reason",  "kind": "select", "required": true,  "options": ["пробка", "погода", "поломка"] }
]
```

Системные записи (`is_system = true`) поставляются с продуктом. Их можно
переименовать или скрыть, но не удалить, чтобы не ломать интеграции.

## Рейс

```
Trip
  id, external_id, number
  status: draft | assigned | accepted | in_progress | completed | cancelled
  driver_id, co_driver_id?, dispatcher_id
  vehicle {plate, model}, trailer {plate}       # пока свободные поля, справочник ТС потом
  cargo { description, weight_kg, volume_m3, pallets, adr_class?, temp_min?, temp_max? }
  planned_start, planned_end
  custom_fields: JSONB                          # любые поля клиента
  chat_id                                       # чат рейса создаётся автоматически

Stage                                           # этап: точка или транзит
  id, external_id, trip_id, seq
  stage_type_id, kind: point | transit          # kind дублируется из типа для быстрых запросов
  state                                         # код текущего состояния из автомата типа
  state_category: pending | active | done | skipped
  assignee_id?                                  # исполнитель; пусто — водитель рейса
  started_at?, finished_at?
  is_auto: bool                                 # транзит вставлен сервером автоматически
  # для point:
  address, lat, lon, timezone
  window_from, window_to                        # окно прибытия
  contact { name, phone }
  # для transit:
  planned_distance_km?, carrier_ref?            # например, судно и рейс парома
  eta?                                          # последнее ETA из событий
  instructions: text
  custom_fields: JSONB

Incident                                        # параллельный инцидент
  id, trip_id, stage_id?, incident_type_id
  status: open | acknowledged | resolved
  opened_by_event_id, closed_by_event_id?
  blocks_progress: bool

StageRequirement
  id, stage_id, requirement_type_id, title, required: bool
  fulfilled_by_event_id?                        # каким событием закрыто
```

Переход с флагом `requires_requirements` недоступен, пока не закрыты все
обязательные требования этапа. Диспетчер может выполнить переход
принудительно, с причиной; это фиксируется в журнале.

В каждый момент у рейса не больше одного этапа с `state_category = active`.

## Событие

```
Event
  id                    # UUID, генерирует клиент (офлайн)
  trip_id, stage_id?    # stage_id пустой — событие по рейсу целиком
  event_type_id
  author_id, author_role
  occurred_at           # когда произошло (по устройству)
  received_at           # когда дошло до сервера
  lat, lon, accuracy_m  # геопозиция на момент события
  values: JSONB         # заполненные поля по схеме EventType.fields
  attachments[]
  source: app | api | system
  forced: bool, force_reason?   # диспетчер выполнил переход за исполнителя
  status: applied | conflict    # conflict — офлайн-событие не легло в текущий автомат
  state_from?, state_to?        # для переходов: снимок для журнала
  incident_id?
```

События не редактируются и не удаляются: это журнал. Ошибочное событие
отменяется новым событием `cancelled_event` со ссылкой на исходное.

## Чаты

```
Chat
  id, external_id
  kind: direct | group | trip
  title?, trip_id?
  members[] { user_id, role_in_chat: owner|member, last_read_message_id }

Message
  id                    # UUID с клиента
  chat_id, author_id
  kind: text | file | voice | location | system
  text?, attachments[]
  ref?                  # ссылка на Trip / Stage / Event: карточка в ленте
  created_at, edited_at?, deleted_at?
```

В чате рейса задание, изменения маршрута и события показываются как системные
карточки (`kind = system` с полем `ref`). Так переписка и ход рейса идут в
одной ленте.

## Вложения

```
Attachment
  id, owner_type, owner_id, file_name, mime, size, storage_key, sha256
  taken_at?, lat?, lon?   # для фото с места
```

## Интеграции

```
ApiToken     id, name, token_hash, scopes[], last_used_at, expires_at?
Webhook      id, url, secret, events[] (trip.*, stage.*, event.created, message.created ...)
WebhookDelivery  id, webhook_id, payload, status, attempts, next_retry_at
```
