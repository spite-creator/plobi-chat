# Базовые справочники (черновик)

Поставляются с продуктом как системные. Компания может переименовать или
скрыть их, а также добавить свои состояния, переходы, события и типы этапов.
Механика описана в [state-machine.md](state-machine.md). **Список нужно сверить
с практикой.**

## Типы этапов: точки

| code | Название | Состояния внутри `active` |
|---|---|---|
| `loading` | Погрузка | arrived → queue → at_dock → loading → loaded → docs_received; ветка refused |
| `unloading` | Выгрузка | arrived → queue → at_dock → unloading → unloaded → docs_signed; ветка claim |
| `customs_export` | Экспортная таможня | arrived → docs_submitted ⇄ inspection → released; ветка detained |
| `customs_import` | Импортная таможня | то же |
| `customs_transit_open` | Открытие транзита (T1/TIR) | то же |
| `customs_transit_close` | Закрытие транзита | то же |
| `border` | Пересечение границы | arrived → queue → passport_control → customs_control |
| `ferry_port_departure` | Порт отправления | arrived → checked_in → waiting → boarding |
| `ferry_port_arrival` | Порт прибытия | disembarked |
| `rail_terminal_departure` | Ж/д терминал отправления | arrived → checked_in → waiting → loading_on_train |
| `rail_terminal_arrival` | Ж/д терминал прибытия | unloaded_from_train |
| `trailer_drop` | Отцепка прицепа | arrived → dropped |
| `trailer_pickup` | Сцепка прицепа | arrived → coupled ⟨фото, пломба⟩ |
| `crew_change` | Смена водителя | arrived → handed_over |
| `weighing` | Взвешивание | arrived → weighed ⟨вес⟩ |
| `control` | Фито / вет / санконтроль | arrived → submitted → released |
| `parking` | Плановая стоянка | arrived |
| `fuel` | Плановая заправка | arrived |
| `waypoint` | Промежуточная точка | arrived |

## Типы этапов: транзиты

| code | Вид | Состояния |
|---|---|---|
| `transit_road` | road | pending → moving ⇄ resting / stopped → done |
| `transit_ferry` | ferry | pending → on_board → sailing → done |
| `transit_rail` | rail | pending → on_train → in_transit → done |

## События-переходы (водитель)

| code | Название | Где | Поля |
|---|---|---|---|
| `trip_accepted` | Принял рейс | рейс | — |
| `trip_declined` | Отказался от рейса | рейс | причина |
| `arrived` | Прибыл | конец транзита / начало точки | фото (опц.) |
| `queue_joined` | Встал в очередь | точки с очередью | номер в очереди (опц.) |
| `at_dock` | Поставлен на рампу | погрузка, выгрузка | номер рампы |
| `loading_started` / `unloading_started` | Начало погрузки / выгрузки | погрузка, выгрузка | — |
| `loaded` | Погружен | погрузка | фото груза, номер пломбы, кол-во паллет |
| `unloaded` | Выгружен | выгрузка | фото |
| `docs_received` / `docs_signed` | Документы получены / подписаны | погрузка, выгрузка | фото CMR/ТТН |
| `refused` / `claim` | Отказ в погрузке / Претензия при выгрузке | погрузка, выгрузка | причина, фото |
| `docs_submitted` | Подал документы | таможня, контроль | фото |
| `inspection_started` / `inspection_finished` | Досмотр начат / окончен | таможня | — |
| `released` | Выпуск | таможня, контроль | номер декларации (опц.) |
| `detained` / `detention_lifted` | Задержан / Задержание снято | таможня | причина |
| `border_queue` / `passport_control` / `border_crossed` | Очередь / Паспортный контроль / Границу пересёк | граница | — |
| `checked_in` | Регистрация в порту / на терминале | порт, терминал | фото билета, номер брони |
| `boarding` / `on_board` | Посадка / На борту | порт | — |
| `missed_departure` | Не попал на рейс | порт | новый рейс, ETA |
| `vessel_departed` / `vessel_arrived` | Отплытие / Прибытие судна | транзит ferry | — |
| `disembarked` | Съехал с парома | порт прибытия | — |
| `trailer_dropped` / `trailer_coupled` | Отцепил / Сцепил прицеп | отцепка, сцепка | фото, пломба, номер прицепа |
| `rest_started` / `rest_finished` | Начал / закончил отдых | транзит road | тип отдыха (короткий / ежедневный / еженедельный) |
| `stopped` / `resumed` | Остановка / Продолжил движение | транзит road | причина |
| `departed` | Убыл | конец точки / начало транзита | — |

## Информационные события (водитель)

| code | Название | Поля |
|---|---|---|
| `eta_update` | Новое ETA | время, причина |
| `temp_reading` | Температура рефа | °C, фото дисплея |
| `fuel_receipt` | Заправка | литры, сумма, фото чека |
| `expense` | Расход (платная дорога, стоянка, паром) | сумма, валюта, фото |
| `photo_report` | Фотоотчёт | фото, комментарий |
| `note` | Заметка | текст |

## Инциденты

| code | Название | Блокирует движение | Важность |
|---|---|---|---|
| `breakdown` | Поломка | да | critical |
| `accident` | ДТП | да | critical |
| `cargo_damage` | Повреждение / недостача груза | нет | critical |
| `docs_problem` | Проблема с документами | да | warning |
| `police_stop` | Остановка полицией / штраф | нет | warning |
| `reefer_failure` | Отказ рефустановки | нет | critical |
| `health` | Плохое самочувствие водителя | да | critical |

Водитель открывает инцидент событием `*_reported`. Диспетчер подтверждает его
(`acknowledged`) и закрывает (`resolved`) с комментарием.

## События диспетчера

| code | Название | Действие | Поля |
|---|---|---|---|
| `trip_assigned` | Назначен водитель | переход рейса | водитель |
| `route_changed` | Изменение маршрута | info | комментарий |
| `docs_sent` | Документы отправлены водителю | info | файлы |
| `slot_confirmed` | Слот на складе подтверждён | info | время, номер слота |
| `ferry_booked` | Паром забронирован | info | судно, рейс, номер брони, время |
| `customer_notified` | Клиент уведомлён | info | комментарий |
| `downtime_confirmed` | Простой подтверждён | info | часы, комментарий |
| `stage_skipped` | Этап пропущен | переход в skipped | причина |
| `forced_transition` | Переход за водителя | любой переход | причина |
| `incident_acknowledged` / `incident_resolved` | Инцидент принят / решён | инцидент | комментарий |
| `trip_closed` | Рейс закрыт (документы получены) | переход рейса | — |
| `trip_cancelled` | Рейс отменён | переход рейса | причина |

## Системные события

| code | Когда |
|---|---|
| `late_for_window` | этап не начат к `window_to` |
| `eta_after_window` | ETA позже окна прибытия |
| `long_stop` | состояние `stopped` дольше N минут |
| `no_signal` | от водителя нет данных N часов |
| `event_conflict` | офлайн-событие не легло в автомат |
