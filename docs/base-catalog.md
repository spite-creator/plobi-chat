# Базовые справочники (черновик)

Поставляются с продуктом как системные. Компания может переименовать или
скрыть их, а также добавить свои типы этапов и события. Автомат статусов
при этом не меняются, см. [state-machine.md](state-machine.md). **Список
нужно сверить с практикой.**

Обозначения в колонке «Статус»: **→ X** — событие переводит этап в статус X;
**· X** — уточняющее событие, доступное в статусе X, статус не меняет.

## Универсальные события (на любой точке)

| code | Название | Статус |
|---|---|---|
| `arrived` | Прибыл | → arrived |
| `work_started` | Начата работа / В процессе | → in_progress |
| `paused` | Пауза | → paused ⟨причина⟩ |
| `resumed` | Продолжить | → in_progress |
| `work_finished` | Работа закончена | → work_done |
| `departed` | Убыл | → completed |

Типы этапов ниже добавляют к ним свои формулировки и уточнения.

## Типы точек

| code | Название | Профиль | Убыть без работы |
|---|---|---|---|
| `loading` | Погрузка | point_split | с причиной |
| `unloading` | Выгрузка | point_split | с причиной |
| `customs_export` | Экспортная таможня | point_split | нельзя |
| `customs_import` | Импортная таможня | point_split | нельзя |
| `customs_transit_open` | Открытие транзита (T1/TIR) | point_split | нельзя |
| `customs_transit_close` | Закрытие транзита | point_split | нельзя |
| `control` | Фито / вет / санконтроль | point_split | с причиной |
| `border` | Пересечение границы | point_single | нельзя |
| `weighing` | Взвешивание | point_single | с причиной |
| `ferry_port_departure` | Порт отправления (паром) | point_single | с причиной |
| `ferry_port_arrival` | Порт прибытия (паром) | point_simple | да |
| `rail_terminal_departure` | Ж/д терминал отправления | point_single | с причиной |
| `rail_terminal_arrival` | Ж/д терминал прибытия | point_single | да |
| `trailer_drop` | Отцепка прицепа | point_single | нельзя |
| `trailer_pickup` | Сцепка прицепа | point_single | нельзя |
| `crew_change` | Смена водителя | point_single | нельзя |
| `parking` | Плановая стоянка | point_simple | да |
| `fuel` | Плановая заправка | point_simple | да |
| `waypoint` | Промежуточная точка | point_simple | да |

## События по типам точек

### Погрузка / выгрузка

| code | Название | Статус | Поля |
|---|---|---|---|
| `queue_joined` | Встал в очередь | · arrived | номер в очереди |
| `at_dock` | Поставлен на рампу | · arrived | номер рампы |
| `loading_started` / `unloading_started` | Начало погрузки / выгрузки | → in_progress | — |
| `photo_cargo` | Фото груза | · in_progress, work_done | фото |
| `temp_reading` | Температура | · in_progress, work_done | °C, фото дисплея |
| `loaded` / `unloaded` | Погружен / Выгружен | → work_done | фото, кол-во паллет |
| `seal_set` | Пломба установлена | · work_done | номер, фото |
| `docs_received` / `docs_signed` | Документы получены / подписаны | · work_done | фото CMR/ТТН |
| `refused` | Отказ в погрузке / приёмке | · arrived, in_progress | причина, фото |
| `claim` | Расхождение при выгрузке | · in_progress, work_done | описание, фото |

Требования по умолчанию для погрузки: `loaded`, `seal_set`, `docs_received`
обязательны до `completed` («Убыл»).

### Таможня / контроль

| code | Название | Статус | Поля |
|---|---|---|---|
| `queue_joined` | Встал в очередь | · arrived | — |
| `docs_submitted` | Подал документы | → in_progress | фото |
| `inspection_started` / `inspection_finished` | Досмотр начат / окончен | · in_progress | — |
| `detained` | Задержан | → paused | причина |
| `detention_lifted` | Задержание снято | → in_progress | — |
| `released` | Выпуск | → work_done | номер декларации |

### Граница

| code | Название | Статус |
|---|---|---|
| `border_queue` | Очередь на границе | · arrived |
| `border_control_started` | Начат контроль | → in_progress |
| `border_crossed` | Границу пересёк | → completed |

### Паромный порт

| code | Название | Статус | Поля |
|---|---|---|---|
| `checked_in` | Регистрация | · arrived | фото билета, номер брони |
| `missed_departure` | Не попал на рейс | · arrived | новый рейс, ETA |
| `boarding` | Посадка | → in_progress | — |
| `on_board` | На борту | → completed | — |
| `disembarked` | Съехал с парома | → completed (порт прибытия) | — |

### Отцепка / сцепка / смена водителя

| code | Название | Статус | Поля |
|---|---|---|---|
| `trailer_dropped` | Прицеп отцеплен | → in_progress | фото, номер прицепа, пломба |
| `trailer_coupled` | Прицеп сцеплен | → in_progress | фото, номер прицепа, пломба |
| `handover` | ТС передано | → in_progress | фото, пробег, топливо |

После этих событий этап закрывается обычным «Убыл» (`completed`).

## События транзита

| code | Название | Статус | Поля |
|---|---|---|---|
| — | (старт) | → in_progress (road) / → paused (ferry, rail) | автоматически при «Убыл» с предыдущей точки |
| `rest_started` | Начал отдых | → paused | тип: короткий / ежедневный / еженедельный |
| `stopped` | Остановка | → paused | причина: пробка, полиция, погода, дорога закрыта, прочее |
| `moving_resumed` | Продолжил движение | → in_progress | — |
| `vessel_departed` | Отплытие (паром) | → in_progress | — |
| `vessel_delayed` | Задержка парома | → paused | новое время |
| `eta_update` | Новое ETA | · in_progress, paused | время, причина |
| `fuel_receipt` | Заправка | · in_progress, paused | литры, сумма, фото чека |
| `expense` | Расход (дорога, стоянка, паром) | · in_progress, paused | сумма, валюта, фото |
| `photo_report` | Фотоотчёт | · любой | фото, комментарий |
| — | (финиш) | → completed | автоматически при `arrived` на следующей точке |

## Инциденты

| code | Название | blocks_progress | auto_pause | Важность |
|---|---|---|---|---|
| `breakdown` | Поломка | да | да | critical |
| `accident` | ДТП | да | да | critical |
| `cargo_damage` | Повреждение / недостача груза | нет | нет | critical |
| `docs_problem` | Проблема с документами | да | нет | warning |
| `police_stop` | Остановка полицией / штраф | нет | да | warning |
| `reefer_failure` | Отказ рефустановки | нет | нет | critical |
| `health` | Плохое самочувствие водителя | да | да | critical |

## События диспетчера

| code | Название | Действие | Поля |
|---|---|---|---|
| `trip_assigned` | Назначен водитель | рейс → assigned | водитель |
| `route_changed` | Изменение маршрута | уточняющее | комментарий |
| `docs_sent` | Документы отправлены водителю | уточняющее | файлы |
| `slot_confirmed` | Слот на складе подтверждён | уточняющее (этап впереди) | время, номер слота |
| `ferry_booked` | Паром забронирован | уточняющее (этап впереди) | судно, рейс, бронь, время |
| `customer_notified` | Клиент уведомлён | уточняющее | комментарий |
| `downtime_confirmed` | Простой подтверждён | уточняющее (completed) | часы, комментарий |
| `stage_skipped` | Этап пропущен | → skipped | причина |
| — | Любое статусное событие за водителя | `forced` | причина |
| `incident_acknowledged` / `incident_resolved` | Инцидент принят / решён | инцидент | комментарий |
| `trip_closed` | Рейс закрыт (документы получены) | рейс → closed | — |
| `trip_cancelled` | Рейс отменён | рейс → cancelled | причина |

## Системные события

| code | Когда |
|---|---|
| `late_for_window` | точка не в `arrived` к `window_to` |
| `eta_after_window` | ETA позже окна прибытия |
| `long_wait` | в `arrived` дольше N минут (очередь, простой) |
| `long_stop` | транзит в `paused` дольше N минут без отдыха |
| `no_signal` | от водителя нет данных N часов |
| `event_conflict` | событие не вписалось в автомат при пересчёте |
