/**
 * Base catalog shipped with the product (see docs/base-catalog.md).
 * Companies rename, hide or extend it; the machines stay the same.
 */
import type {
  Catalog,
  EventField,
  EventScope,
  EventType,
  IncidentType,
  RequirementRule,
  RequirementTemplate,
  StageType,
} from './types.js';

const ru = (text: string) => ({ ru: text });
const byCode = <T extends { code: string }>(items: readonly T[]): Record<string, T> =>
  Object.fromEntries(items.map((i) => [i.code, i]));

// ---------- stage types ----------

const point = (
  code: string,
  name: string,
  profile: StageType['profile'],
  departWithoutWork: StageType['departWithoutWork'],
  extra: Partial<StageType> = {},
): StageType => ({ code, name: ru(name), kind: 'point', profile, departWithoutWork, ...extra });

/**
 * Two questions keep the point types apart:
 * - Does the driver stay with the cargo? Yes (on the ferry with the tractor) → ferry_embark / ferry_disembark.
 *   No (warehouse, ship, train, plane) → handover / takeover: responsibility changes, no transit in between.
 * - Is it planned? Checks, weighing, crew change, trailer drop are not points but events.
 */
const STAGE_TYPES: StageType[] = [
  point('depot', 'База / гараж', 'point_simple', 'allow'),
  point('loading', 'Погрузка', 'point_split', 'with_reason'),
  point('export_clearance', 'Экспортное оформление', 'point_split', 'deny'),
  point('border_exit', 'Выезд через погранпереход', 'point_single', 'deny'),
  point('border_entry', 'Въезд через погранпереход', 'point_single', 'deny'),
  point('border_open', 'Быстрый погранпереход', 'point_mark', 'allow', { autoPass: true }),
  point('ferry_embark', 'Заезд на паром', 'point_single', 'with_reason'),
  point('ferry_disembark', 'Съезд с парома', 'point_simple', 'allow'),
  point('handover', 'Сдача груза / прицепа / машины', 'point_split', 'with_reason', { noTransitAfter: true }),
  point('takeover', 'Приём груза / прицепа / машины', 'point_split', 'with_reason'),
  point('import_clearance', 'Импортное оформление', 'point_split', 'deny'),
  point('unloading', 'Выгрузка', 'point_split', 'with_reason'),
  point('waypoint', 'Промежуточная точка', 'point_simple', 'allow'),
  { code: 'transit', name: ru('Транзит'), kind: 'transit', profile: 'transit' },
];

// ---------- fields ----------

const reason = (options?: string[]): EventField => ({
  key: 'reason',
  kind: options ? 'select' : 'text',
  required: true,
  ...(options ? { options } : {}),
});
const comment: EventField = { key: 'comment', kind: 'text' };
const photos = (min = 1, required = true): EventField => ({ key: 'photos', kind: 'photo', required, min, cameraOnly: true });

// ---------- event types ----------

const DRIVER: EventScope['roles'] = ['driver'];
const DISPATCHER: EventScope['roles'] = ['dispatcher'];
const WORKING = ['started', 'resumed'] as const;
const WORKING_OR_PAUSED = ['started', 'paused', 'resumed'] as const;

const phase = (code: string, name: string, setsPhase: EventType['setsPhase'], scope: EventScope, fields?: EventField[]): EventType => ({
  code,
  name: ru(name),
  action: 'phase',
  setsPhase,
  // Only the stage's assignee moves its phase: after a takeover, the receiving driver.
  scope: { roles: DRIVER, assigneeOnly: true, ...scope },
  ...(fields ? { fields } : {}),
});

const detail = (code: string, name: string, scope: EventScope, fields?: EventField[]): EventType => ({
  code,
  name: ru(name),
  action: 'detail',
  scope: { roles: DRIVER, ...scope },
  ...(fields ? { fields } : {}),
});

const incident = (code: string, name: string, incidentType: string): EventType => ({
  code,
  name: ru(name),
  action: 'incident_open',
  incidentType,
  scope: { roles: ['driver', 'dispatcher'] },
  fields: [photos(1, false), comment],
  severity: 'critical',
});

const POINT = { kinds: ['point'] } as const;
const ROAD = { kinds: ['transit'], transportModes: ['road'] } as const;
const FERRY = { kinds: ['transit'], transportModes: ['ferry'] } as const;
const types = (...codes: string[]) => ({ stageTypes: codes });
const CLEARANCE = ['export_clearance', 'import_clearance'];
const BORDER = ['border_exit', 'border_entry'];
const CARGO_WORK = ['loading', 'unloading', 'handover', 'takeover'];
/** What a handover / takeover transfers. */
const transferred: EventField = {
  key: 'transferred',
  kind: 'multiselect',
  required: true,
  options: ['cargo', 'trailer', 'tractor', 'container', 'documents'],
};

const EVENT_TYPES: EventType[] = [
  // universal point events (only the assignee of the stage marks them)
  phase('arrived', 'Прибыл', 'arrived', POINT),
  phase('work_started', 'Начато', 'started', POINT),
  phase('paused', 'Приостановлено', 'paused', POINT, [reason()]),
  phase('resumed', 'Возобновлено', 'resumed', POINT),
  phase('work_finished', 'Завершено', 'completed', POINT),
  phase('departed', 'Убыл', 'departed', POINT),

  // loading / unloading
  phase('loading_started', 'Начало погрузки', 'started', types('loading')),
  phase('loaded', 'Погружен', 'completed', types('loading')),
  phase('unloading_started', 'Начало выгрузки', 'started', types('unloading')),
  phase('unloaded', 'Выгружен', 'completed', types('unloading')),
  detail('queue_joined', 'Встал в очередь', { ...types(...CARGO_WORK, ...CLEARANCE, ...BORDER, 'ferry_embark'), phases: ['arrived'] }),
  detail('at_dock', 'Поставлен на рампу', { ...types(...CARGO_WORK), phases: ['arrived'] }, [{ key: 'dock', kind: 'text' }]),
  detail('photo_process', 'Фото процесса', { ...POINT, phases: [...WORKING_OR_PAUSED, 'completed'] }, [photos()]),
  detail('seal_set', 'Пломба установлена', { ...types('loading', 'handover', 'takeover'), phases: ['completed', ...WORKING] }, [
    { key: 'seal_number', kind: 'scan', required: true },
    photos(),
  ]),
  detail('docs_received', 'Документы получены', { ...types(...CARGO_WORK), phases: ['completed'] }, [
    { key: 'documents', kind: 'document', required: true },
  ]),

  // handover / takeover: the responsible person changes here
  phase('handover_started', 'Начало сдачи', 'started', types('handover')),
  phase('handed_over', 'Сдано', 'completed', types('handover'), [transferred, { key: 'to', kind: 'text' }]),
  phase('takeover_started', 'Начало приёма', 'started', types('takeover')),
  phase('taken_over', 'Принято', 'completed', types('takeover'), [transferred, { key: 'remarks', kind: 'text' }]),

  // customs clearance
  phase('docs_submitted', 'Подал документы', 'started', types(...CLEARANCE)),
  phase('detained', 'Задержан', 'paused', types(...CLEARANCE), [reason()]),
  phase('detention_lifted', 'Задержание снято', 'resumed', types(...CLEARANCE)),
  phase('released', 'Выпуск', 'completed', types(...CLEARANCE)),

  // border
  detail('border_queue', 'Очередь на границе', { ...types(...BORDER), phases: ['arrived'] }),
  phase('border_control_started', 'Начат контроль', 'started', types(...BORDER)),
  phase('border_crossed', 'Границу пересёк', 'departed', types(...BORDER)),
  phase('border_passed', 'Пройдено', 'departed', types('border_open')),

  // ferry: the driver stays with the cargo and goes on board with the tractor
  detail('checked_in', 'Регистрация', { ...types('ferry_embark'), phases: ['arrived'] }, [
    { key: 'booking', kind: 'text' },
    photos(1, false),
  ]),
  phase('boarding', 'Посадка', 'started', types('ferry_embark')),
  phase('on_board', 'На борту', 'departed', types('ferry_embark')),
  phase('disembarked', 'Съехал', 'arrived', types('ferry_disembark')),
  detail('ferry_departed', 'Отплытие', FERRY),
  detail('ferry_delayed', 'Задержка парома', FERRY, [{ key: 'new_time', kind: 'datetime', required: true }]),

  // road transit
  phase('rest_started', 'Начал отдых', 'paused', ROAD, [
    { key: 'reason', kind: 'select', required: true, options: ['short', 'daily', 'weekly'] },
  ]),
  phase('stopped', 'Остановка', 'paused', ROAD, [
    reason(['traffic', 'police', 'weather', 'road_closed', 'other']),
    { key: 'comment', kind: 'text', required: true, showIf: { reason: 'other' } },
  ]),
  phase('moving_resumed', 'Продолжил движение', 'resumed', ROAD),

  // unplanned things that happen on the way: events, not points
  detail('inspection', 'Контроль (фито / вет / сан / полиция)', {}, [
    { key: 'kind', kind: 'select', required: true, options: ['phyto', 'veterinary', 'sanitary', 'police', 'other'] },
    photos(1, false),
    comment,
  ]),
  detail('weighing', 'Взвешивание', {}, [{ key: 'weight_kg', kind: 'number', required: true }, photos(1, false)]),
  detail('crew_change', 'Смена водителя', {}, [{ key: 'new_driver', kind: 'text', required: true }, comment]),
  detail('trailer_dropped', 'Отцепил прицеп', {}, [{ key: 'trailer', kind: 'text', required: true }, photos()]),
  detail('trailer_coupled', 'Прицепил прицеп', {}, [{ key: 'trailer', kind: 'text', required: true }, photos()]),

  // information
  detail('eta_update', 'Новое ETA', { states: ['in_progress'] }, [{ key: 'eta', kind: 'datetime', required: true }, comment]),
  detail('temp_reading', 'Температура рефа', { tagsRequired: ['reefer'] }, [
    { key: 'temperature', kind: 'number', required: true },
    photos(1, false),
  ]),
  detail('acknowledged', 'Ознакомлен', { states: ['ahead', 'in_progress'] }, [
    { key: 'requirementId', kind: 'text', required: true },
    { key: 'revision', kind: 'number', required: true },
  ]),
  detail('fuel_receipt', 'Заправка', ROAD, [
    { key: 'liters', kind: 'number', required: true },
    { key: 'receipt', kind: 'photo', required: true },
  ]),

  // incidents
  incident('breakdown_reported', 'Поломка', 'breakdown'),
  incident('accident_reported', 'ДТП', 'accident'),
  incident('cargo_damage_reported', 'Повреждение груза', 'cargo_damage'),
  { code: 'incident_acknowledged', name: ru('Инцидент принят'), action: 'incident_ack', scope: { roles: DISPATCHER } },
  { code: 'incident_resolved', name: ru('Инцидент решён'), action: 'incident_resolve', scope: { roles: DISPATCHER }, fields: [comment] },

  // dispatcher
  { code: 'stage_skipped', name: ru('Этап пропущен'), action: 'skip', scope: { roles: DISPATCHER }, fields: [reason()] },
  { code: 'requirement_waived', name: ru('Требование снято'), action: 'waive', scope: { roles: DISPATCHER }, fields: [reason()] },
  detail('downtime_confirmed', 'Простой подтверждён', { ...POINT, roles: DISPATCHER, states: ['in_progress', 'passed'] }, [
    { key: 'hours', kind: 'number', required: true },
  ]),

  // trip
  { code: 'trip_accepted', name: ru('Рейс принят'), action: 'trip_accept', scope: { roles: DRIVER } },
  { code: 'trip_closed', name: ru('Рейс закрыт'), action: 'trip_close', scope: { roles: DISPATCHER } },
  { code: 'trip_cancelled', name: ru('Рейс отменён'), action: 'trip_cancel', scope: { roles: DISPATCHER }, fields: [reason()] },
];

// ---------- incidents ----------

const INCIDENT_TYPES: IncidentType[] = [
  { code: 'breakdown', name: ru('Поломка'), blocksProgress: true, autoPause: true, severity: 'critical' },
  { code: 'accident', name: ru('ДТП'), blocksProgress: true, autoPause: true, severity: 'critical' },
  { code: 'cargo_damage', name: ru('Повреждение / недостача груза'), blocksProgress: false, autoPause: false, severity: 'critical' },
  { code: 'docs_problem', name: ru('Проблема с документами'), blocksProgress: true, autoPause: false, severity: 'warning' },
  { code: 'reefer_failure', name: ru('Отказ рефустановки'), blocksProgress: false, autoPause: false, severity: 'critical' },
];

// ---------- requirements ----------

const REQUIREMENT_TEMPLATES: RequirementTemplate[] = [
  { code: 'loading_process_photos', title: ru('Фото процесса погрузки'), kind: 'photo', min: 3, cameraOnly: true, captureFromPhase: 'started', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'seal_number', title: ru('Номер пломбы'), kind: 'scan', valueKey: 'seal_number', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'seal_photo', title: ru('Фото пломбы'), kind: 'photo', cameraOnly: true, beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'cmr_signed', title: ru('Подписанная CMR / ТТН'), kind: 'document', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'unloading_cargo_before', title: ru('Фото груза до выгрузки'), kind: 'photo', cameraOnly: true, beforePhase: 'started', strictness: 'warn', waivable: true },
  { code: 'unloading_process_photos', title: ru('Фото процесса выгрузки'), kind: 'photo', min: 3, cameraOnly: true, captureFromPhase: 'started', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'proof_of_delivery', title: ru('Подписанная CMR при выгрузке'), kind: 'document', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'customs_release_docs', title: ru('Документы о выпуске'), kind: 'document', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'transfer_photos', title: ru('Фото груза / прицепа при передаче'), kind: 'photo', min: 4, cameraOnly: true, captureFromPhase: 'started', beforePhase: 'completed', strictness: 'block', waivable: true },
  { code: 'transfer_act', title: ru('Акт приёма-передачи'), kind: 'document', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'ferry_ticket', title: ru('Фото билета / брони'), kind: 'photo', beforePhase: 'started', strictness: 'warn', waivable: true },
  { code: 'reefer_temperature', title: ru('Температура рефа'), kind: 'number', valueKey: 'temperature', beforePhase: 'departed', strictness: 'block', waivable: true },
  { code: 'adr_parking', title: ru('Опасный груз: не останавливаться у жилых домов и АЗС'), kind: 'acknowledgement', beforePhase: 'arrived', strictness: 'block', waivable: true },
  { code: 'reefer_check', title: ru('Проверьте, что реф включён и выставлена температура по заявке'), kind: 'acknowledgement', showAt: 'arrived', beforePhase: 'started', strictness: 'block', waivable: true },
  { code: 'clean_body_photo', title: ru('Фото чистого пустого кузова'), kind: 'photo', cameraOnly: true, beforePhase: 'started', strictness: 'block', waivable: true },
];

const REQUIREMENT_RULES: RequirementRule[] = [
  { template: 'loading_process_photos', stageTypes: ['loading'] },
  { template: 'seal_number', stageTypes: ['loading'] },
  { template: 'seal_photo', stageTypes: ['loading'] },
  { template: 'cmr_signed', stageTypes: ['loading'] },
  { template: 'unloading_cargo_before', stageTypes: ['unloading'] },
  { template: 'unloading_process_photos', stageTypes: ['unloading'] },
  { template: 'proof_of_delivery', stageTypes: ['unloading'] },
  { template: 'customs_release_docs', stageTypes: ['export_clearance', 'import_clearance'] },
  { template: 'transfer_photos', stageTypes: ['handover', 'takeover'] },
  { template: 'transfer_act', stageTypes: ['handover', 'takeover'] },
  { template: 'ferry_ticket', stageTypes: ['ferry_embark'] },
  { template: 'reefer_temperature', stageTypes: ['loading'], tagsRequired: ['reefer'] },
  { template: 'clean_body_photo', stageTypes: ['loading'], tagsRequired: ['food'] },
  { template: 'adr_parking', stageTypes: ['loading'], tagsRequired: ['adr'] },
  { template: 'reefer_check', stageTypes: ['loading'], tagsRequired: ['reefer'] },
];

export const BASE_CATALOG: Catalog = {
  stageTypes: byCode(STAGE_TYPES),
  eventTypes: byCode(EVENT_TYPES),
  incidentTypes: byCode(INCIDENT_TYPES),
  requirementTemplates: byCode(REQUIREMENT_TEMPLATES),
  requirementRules: REQUIREMENT_RULES,
};
