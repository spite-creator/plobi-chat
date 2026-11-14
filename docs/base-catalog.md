# Базовые справочники (черновик)

Поставляются с продуктом как системные. Компания может переименовать или
скрыть их, а также добавить свои типы этапов и события. Автоматы статусов
при этом не меняются, см. [state-machine.md](state-machine.md). **Список
нужно сверить с практикой.**

Обозначения в колонке «Статус»: **→ X** — событие переводит этап в статус X;
**· X** — уточняющее событие, доступное в статусе X, статус не меняет.

## Универсальные события (на любой точке)

| code | Название | Статус |
|---|---|---|
| `arrived` | Прибыл | → arrived |
| `work_started` | Начата работа / В процессе | → in_work |
| `paused` | Пауза | → paused ⟨причина⟩ |
| `resumed` | Продолжить | → in_work |
| `work_finished` | Работа закончена | → work_done |
| `departed` | Убыл | → departed |

Типы этапов ниже добавляют к ним свои формулировки и уточнения.

## Типы точек

| code | Название | work_mode | Убыть без работы |
|---|---|---|---|
| `loading` | Погрузка | split | с причиной |
| `unloading` | Выгрузка | split | с причиной |
| `customs_export` | Экспортная таможня | split | нельзя |
| `customs_import` | Импортная таможня | split | нельзя |
| `customs_transit_open` | Открытие транзита (T1/TIR) | split | нельзя |
| `customs_transit_close` | Закрытие транзита | split | нельзя |
| `control` | Фито / вет / санконтроль | split | с причиной |
| `border` | Пересечение границы | single | нельзя |
| `weighing` | Взвешивание | single | с причиной |
| `ferry_port_departure` | Порт отправления (паром) | single | с причиной |
| `ferry_port_arrival` | Порт прибытия (паром) | none | да |
| `rail_terminal_departure` | Ж/д терминал отправления | single | с причиной |
| `rail_terminal_arrival` | Ж/д терминал прибытия | single | да |
| `trailer_drop` | Отцепка прицепа | single | нельзя |
| `trailer_pickup` | Сцепка прицепа | single | нельзя |
| `crew_change` | Смена водителя | single | нельзя |
| `parking` | Плановая стоянка | none | да |
| `fuel` | Плановая заправка | none | да |
| `waypoint` | Промежуточная точка | none | да |

## События по типам точек

### Погрузка / выгрузка

| code | Название | Статус | Поля |
|---|---|---|---|
| `queue_joined` | Встал в очередь | · arrived | номер в очереди |
| `at_dock` | Поставлен на рампу | · arrived | номер рампы |
| `loading_started` / `unloading_started` | Начало погрузки / выгрузки | → in_work | — |
| `photo_cargo` | Фото груза | · in_work, work_done | фото |
| `temp_reading` | Температура | · in_work, work_done | °C, фото дисплея |
| `loaded` / `unloaded` | Погружен / Выгружен | → work_done | фото, кол-во паллет |
| `seal_set` | Пломба установлена | · work_done | номер, фото |
| `docs_received` / `docs_signed` | Документы получены / подписаны | · work_done | фото CMR/ТТН |
| `refused` | Отказ в погрузке / приёмке | · arrived, in_work | причина, фото |
| `claim` | Расхождение при выгрузке | · in_work, work_done | описание, фото |

Требования по умолчанию для погрузки: `loaded`, `seal_set`, `docs_received`
обязательны до `departed`.

### Таможня / контроль

| code | Название | Статус | Поля |
|---|---|---|---|
| `queue_joined` | Встал в очередь | · arrived | — |
| `docs_submitted` | Подал документы | → in_work | фото |
| `inspection_started` / `inspection_finished` | Досмотр начат / окончен | · in_work | — |
| `detained` | Задержан | → paused | причина |
| `detention_lifted` | Задержание снято | → in_work | — |
| `released` | Выпуск | → work_done | номер декларации |

### Граница

| code | Название | Статус |
|---|---|---|
| `border_queue` | Очередь на границе | · arrived |
| `border_control_started` | Начат контроль | → in_work |
| `border_crossed` | Границу пересёк | → departed |

### Паромный порт

| code | Название | Статус | Поля |
|---|---|---|---|
| `checked_in` | Регистрация | · arrived | фото билета, номер брони |
| `missed_departure` | Не попал на рейс | · arrived | новый рейс, ETA |
| `boarding` | Посадка | → in_work | — |
| `on_board` | На борту | → departed | — |
| `disembarked` | Съехал с парома | → departed (порт прибытия) | — |

### Отцепка / сцепка / смена водителя

| code | Название | Статус | Поля |
|---|---|---|---|
| `trailer_dropped` | Прицеп отцеплен | → in_work | фото, номер прицепа, пломба |
| `trailer_coupled` | Прицеп сцеплен | → in_work | фото, номер прицепа, пломба |
| `handover` | ТС передано | → in_work | фото, пробег, топливо |

После этих событий этап закрывается обычным `departed`.

## События транзита

| code | Название | Статус | Поля |
|---|---|---|---|
| — | (старт) | → moving (road) / → stopped (ferry, rail) | автоматически при `departed` с предыдущей точки |
| `rest_started` | Начал отдых | → stopped | тип: короткий / ежедневный / еженедельный |
| `stopped` | Остановка | → stopped | причина: пробка, полиция, погода, дорога закрыта, прочее |
| `moving_resumed` | Продолжил движение | → moving | — |
| `vessel_departed` | Отплытие (паром) | → moving | — |
| `vessel_delayed` | Задержка парома | → stopped | новое время |
| `eta_update` | Новое ETA | · moving, stopped | время, причина |
| `fuel_receipt` | Заправка | · moving, stopped | литры, сумма, фото чека |
| `expense` | Расход (дорога, стоянка, паром) | · moving, stopped | сумма, валюта, фото |
| `photo_report` | Фотоотчёт | · любой | фото, комментарий |
| — | (финиш) | → done | автоматически при `arrived` на следующей точке |

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
| `slot_confirmed` | Слот на складе подтверждён | уточняющее (pending) | время, номер слота |
| `ferry_booked` | Паром забронирован | уточняющее (pending) | судно, рейс, бронь, время |
| `customer_notified` | Клиент уведомлён | уточняющее | комментарий |
| `downtime_confirmed` | Простой подтверждён | уточняющее (departed) | часы, комментарий |
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
| `long_stop` | транзит в `stopped` дольше N минут без отдыха |
| `no_signal` | от водителя нет данных N часов |
| `event_conflict` | событие не вписалось в автомат при пересчёте |
