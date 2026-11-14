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

Сейчас прорабатываются две основные роли: **водитель** и **диспетчер**.
Позже появятся роли медика и механика (для будущего модуля путевых листов),
их права пока не определены.

## Справочники (настраиваются компанией)

Подробно механика описана в [state-machine.md](state-machine.md).

```
StageType                       # тип этапа: погрузка, таможня, порт, транзит по дороге...
  code, name{ru,en,...}, icon, color, is_system, sort
  kind: point | transit
  transit_mode?: road | ferry | rail     # только для kind = transit
  profile: point_split | point_single | point_simple | transit
  depart_without_work: allow | with_reason | deny

EventType                       # тип события
  code, name{ru,en,...}, icon, color, is_system
  action: phase | detail | incident_open | incident_close | system
  sets_phase?                   # для action = phase: arrived | started | paused | resumed | completed | departed
  scope:                        # где доступно — «ярлыки», пустое = без ограничений
    kinds[]                     #   point / transit
    stage_types[]               #   конкретные типы этапов
    transit_modes[]             #   road / ferry / rail
    phases[]                    #   в каких фазах этапа
    roles[]                     #   driver / dispatcher / observer / integration
    assignee_only: bool         #   только исполнитель этапа
    tags_required[], tags_excluded[]   # теги рейса или этапа: #reefer, #adr ...
  fields[]                      # что водитель заполняет в форме события (см. ниже)
  incident_type?                # для incident_open / incident_close
  severity: info | warning | critical   # critical — сразу уведомить диспетчера

IncidentType                    # поломка, ДТП, повреждение груза...
  code, name, severity
  blocks_progress: bool         # нельзя «Убыл», пока открыт
  auto_pause: bool              # активный этап in_progress → paused

RequirementTemplate             # шаблон требования (справочник)
  code, title, instructions
  kind: photo | document | signature | scan | number | text | checklist | event
  min?, max?, source: camera | camera_or_gallery
  event_type?                   # для kind = event
  before_phase                  # до какой фазы должно быть выполнено
  capture_window_from_phase?    # засчитывается собранное начиная с этой фазы
  strictness: block | warn
  waivable: bool

RequirementRule                 # когда шаблон применяется автоматически
  requirement_template_id
  ...RuleScope                  # «у всех погрузок» / «#reefer» / «клиент X» / «склад Y»
```

Подробнее о событиях и требованиях: [events-and-requirements.md](events-and-requirements.md).

Автомат фаз один и зафиксирован в коде, тип этапа выбирает только профиль,
см. [state-machine.md](state-machine.md). Компания настраивает типы этапов,
события и требования. При сохранении события проверяется, что `sets_phase`
допустим в профилях выбранных типов этапов.

### Поля события (`fields`)

Описываются декларативно, интерфейс строит форму сам:

```json
[
  { "key": "photo",   "kind": "photo",  "required": true,  "min": 1, "max": 5 },
  { "key": "temp",    "kind": "number", "required": false, "unit": "°C" },
  { "key": "comment", "kind": "text",   "required": false },
  { "key": "reason",  "kind": "select", "required": true,  "options": ["пробка", "погода", "поломка", "прочее"] },
  { "key": "comment2","kind": "text",   "required": true,  "show_if": { "reason": "прочее" } }
]
```

Системные записи (`is_system = true`) поставляются с продуктом. Их можно
переименовать или скрыть, но не удалить, чтобы не ломать интеграции.

## Рейс

```
Trip
  id, external_id, number
  state: draft | assigned | accepted | in_progress | finished | closed | cancelled
  customer_id?
  tags[]                                        # #reefer, #adr, #customs ...
  driver_id, co_driver_id?, dispatcher_id
  vehicle {plate, model}, trailer {plate}       # пока свободные поля, справочник ТС потом
  cargo { description, weight_kg, volume_m3, pallets, adr_class?, temp_min?, temp_max? }
  planned_start, planned_end
  custom_fields: JSONB                          # любые поля клиента
  chat_id                                       # чат рейса создаётся автоматически

Stage                                           # этап: точка или транзит
  id, external_id, trip_id, seq
  stage_type_id, kind: point | transit          # kind дублируется из типа для быстрых запросов
  # вычисляемые поля (кэш, пересчитываются из журнала событий):
  state: ahead | in_progress | passed | skipped    # положение этапа в рейсе, свой автомат
  phase?: arrived | started | paused | resumed | completed | departed   # последняя веха
  arrived_at?, started_at?, completed_at?, departed_at?   # у транзита: started_at, completed_at
  pause_total_sec
  assignee_id?                                  # исполнитель; пусто — водитель рейса
  tags[]                                        # дополняют теги рейса
  is_auto: bool                                 # транзит вставлен сервером автоматически
  # для point:
  place_id?                                     # ссылка на справочник мест
  address, lat, lon, timezone                   # из места или разово
  window_from, window_to                        # окно прибытия
  contact { name, phone }
  # для transit:
  planned_distance_km?, carrier_ref?            # например, судно и рейс парома
  eta?                                          # последнее ETA из событий
  instructions[]                                # StageInstruction, см. ниже
  custom_fields: JSONB

Incident                                        # параллельный инцидент
  id, trip_id, stage_id?, incident_type_id
  state: open | acknowledged | resolved
  opened_by_event_id, closed_by_event_id?
  blocks_progress: bool

StageRequirement                                # требование на конкретном этапе
  id, stage_id, requirement_template_id?        # пусто — разовое требование из API / от диспетчера
  source: stage_type | tag_rule | manual
  ...поля шаблона (копия, можно править для этого этапа)
  state: pending | fulfilled | waived | violated
  evidence[]                                    # какие вложения / события его закрыли
  waived_by?, waive_reason?
```

Требования копируются на этап при создании рейса (по типу этапа и по
правилам тегов) и дальше живут на этапе. Событие фазы недоступно, пока не
выполнены требования `block` до этой фазы. Водитель без связи может пройти с
нарушением (`requirements_unmet`). Диспетчер может снять требование или
выставить событие принудительно; оба действия фиксируются в журнале с
причиной.

В каждый момент у рейса не больше одного этапа в состоянии `in_progress`.

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
  apply_result: applied | conflict   # conflict — событие не легло в автомат при пересчёте
  requirements_unmet: bool      # переход выполнен с невыполненными требованиями (офлайн)
  incident_id?
```

События не редактируются и не удаляются: это журнал. Ошибочное событие
отменяется новым событием `cancelled_event` со ссылкой на исходное.

## Места и инструкции

Подробно: [places-and-instructions.md](places-and-instructions.md).

```
Place
  id, external_id, name, kind?
  address, lat, lon, timezone, working_hours?
  contacts[] { name, phone, role }
  instructions[]                # постоянные, копируются в каждый этап на это место
  tags[]

Customer                        # клиент: заказчик, грузоотправитель, грузополучатель
  id, external_id, name, contacts[]
  # требования клиента = правила с условием customers = [id], редактируются в карточке клиента

RuleScope                       # общие условия правил требований и инструкций
  stage_types[], tags_required[], customers[], places[]

InstructionRule                 # инструкция по правилу (RuleScope + instruction)
  code, ...RuleScope, instruction

StageInstruction                # инструкция на конкретном этапе
  id
  kind: text | contact | photo | location | file | voice | link
  text?, contact?, lat?, lon?, attachment_id?, url?
  show_at: always | arrived | started | completed
  ack_before_phase?             # включает требование «ознакомлен»
  revision                      # растёт при каждом изменении
  source: place | instruction_rule | manual
```

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
