/**
 * Planned together with the driver app (docs/base-catalog.md, "На будущее").
 * Not part of the base catalog yet; the engine already supports it, and
 * EXTENDED_CATALOG lets tests and the simulator use it.
 */
import { BASE_CATALOG, byCode, event, ru } from './base.js';
import type {
  Catalog,
  EventField,
  EventScope,
  EventType,
  IncidentType,
  RequirementRule,
  RequirementTemplate,
} from './types.js';

const DISPATCHER: EventScope['roles'] = ['dispatcher'];
const DRIVER: EventScope['roles'] = ['driver'];
const at = (...stageTypes: string[]) => ({ stageTypes });
const photos = (min = 1, required = true): EventField => ({ key: 'photos', kind: 'photo', required, min, cameraOnly: true });
const reason: EventField = { key: 'reason', kind: 'text', required: true };
const comment: EventField = { key: 'comment', kind: 'text' };
const CARGO_WORK = ['loading', 'unloading', 'handover', 'takeover'];
const WAITING = [...CARGO_WORK, 'export_clearance', 'import_clearance', 'border_exit', 'border_entry', 'ferry_embark'];

const incident = (code: string, name: string, incidentType: string): EventType => ({
  code,
  name: ru(name),
  action: 'incident_open',
  incidentType,
  scope: { roles: ['driver', 'dispatcher'] },
  fields: [photos(1, false), comment],
  severity: 'critical',
});

export const FUTURE_EVENT_TYPES: EventType[] = [
  // details at a point
  event('queue_joined', 'Встал в очередь', 'point', { ...at(...WAITING), phases: ['arrived'] }),
  event('at_dock', 'Поставлен на рампу', 'point', { ...at(...CARGO_WORK), phases: ['arrived'] }, undefined, {
    fields: [{ key: 'dock', kind: 'text' }],
  }),
  event('photo_process', 'Фото процесса', 'here', {}, undefined, { fields: [photos()] }),
  event('seal_set', 'Пломба установлена', 'point', at('loading', 'handover', 'takeover'), undefined, {
    fields: [{ key: 'seal_number', kind: 'scan', required: true }, photos()],
  }),

  // ferry: the driver stays with the cargo and goes on board with the tractor
  event('checked_in', 'Регистрация на паром', 'point', { ...at('ferry_embark'), phases: ['arrived'] }, undefined, {
    fields: [{ key: 'booking', kind: 'text' }, photos(1, false)],
  }),
  event('boarding', 'Посадка', 'point', at('ferry_embark'), 'started'),
  event('on_board', 'На борту', 'point', at('ferry_embark'), 'departed'),
  event('disembarked', 'Съехал', 'point', at('ferry_disembark'), 'arrived'),
  event('ferry_departed', 'Отплытие', 'road', { transportModes: ['ferry'] }),
  event('ferry_delayed', 'Задержка парома', 'road', { transportModes: ['ferry'] }, undefined, {
    fields: [{ key: 'new_time', kind: 'datetime', required: true }],
  }),

  // transit details
  event('eta_update', 'Новое ETA', 'here', {}, undefined, { fields: [{ key: 'eta', kind: 'datetime', required: true }, comment] }),
  event('fuel_receipt', 'Заправка', 'road', { transportModes: ['road'] }, undefined, {
    fields: [{ key: 'liters', kind: 'number', required: true }, { key: 'receipt', kind: 'photo', required: true }],
  }),

  // unplanned, on any current stage
  event('control_check', 'Контроль (фито / вет / сан / полиция)', 'here', {}, undefined, {
    fields: [{ key: 'kind', kind: 'select', required: true, options: ['phyto', 'veterinary', 'sanitary', 'police', 'other'] }, photos(1, false)],
  }),
  event('weighing', 'Взвешивание', 'here', {}, undefined, { fields: [{ key: 'weight_kg', kind: 'number', required: true }] }),
  event('crew_change', 'Смена водителя', 'here', {}, undefined, { fields: [{ key: 'new_driver', kind: 'text', required: true }] }),
  event('trailer_dropped', 'Отцепил прицеп', 'here', {}, undefined, { fields: [{ key: 'trailer', kind: 'text', required: true }, photos()] }),
  event('trailer_coupled', 'Прицепил прицеп', 'here', {}, undefined, { fields: [{ key: 'trailer', kind: 'text', required: true }, photos()] }),

  // requirements: acknowledgement names its stage
  {
    code: 'acknowledged',
    name: ru('Ознакомлен'),
    action: 'detail',
    scope: { roles: DRIVER, states: ['ahead', 'in_progress'] },
    fields: [{ key: 'requirementId', kind: 'text', required: true }, { key: 'revision', kind: 'number', required: true }],
  },

  // incidents
  incident('breakdown_reported', 'Поломка', 'breakdown'),
  incident('cargo_damage_reported', 'Повреждение груза', 'cargo_damage'),
  { code: 'incident_acknowledged', name: ru('Инцидент принят'), action: 'incident_ack', scope: { roles: DISPATCHER } },
  { code: 'incident_resolved', name: ru('Инцидент решён'), action: 'incident_resolve', scope: { roles: DISPATCHER }, fields: [comment] },

  // dispatcher
  { code: 'stage_skipped', name: ru('Этап пропущен'), action: 'skip', scope: { roles: DISPATCHER }, fields: [reason] },
  { code: 'requirement_waived', name: ru('Требование снято'), action: 'waive', scope: { roles: DISPATCHER }, fields: [reason] },

  // trip
  { code: 'trip_accepted', name: ru('Рейс принят'), action: 'trip_accept', scope: { roles: DRIVER } },
  { code: 'trip_closed', name: ru('Рейс закрыт'), action: 'trip_close', scope: { roles: DISPATCHER } },
  { code: 'trip_cancelled', name: ru('Рейс отменён'), action: 'trip_cancel', scope: { roles: DISPATCHER }, fields: [reason] },
];

export const FUTURE_INCIDENT_TYPES: IncidentType[] = [
  { code: 'breakdown', name: ru('Поломка'), blocksProgress: true, autoPause: true, severity: 'critical' },
  { code: 'cargo_damage', name: ru('Повреждение / недостача груза'), blocksProgress: false, autoPause: false, severity: 'critical' },
];

const tpl = (t: RequirementTemplate) => t;
export const FUTURE_REQUIREMENT_TEMPLATES: RequirementTemplate[] = [
  tpl({ code: 'loading_process_photos', title: ru('Фото процесса погрузки'), kind: 'photo', min: 3, cameraOnly: true, captureFromPhase: 'started', beforePhase: 'departed' }),
  tpl({ code: 'seal_number', title: ru('Номер пломбы'), kind: 'scan', valueKey: 'seal_number', beforePhase: 'departed' }),
  tpl({ code: 'cmr_signed', title: ru('Подписанная CMR / ТТН'), kind: 'document', beforePhase: 'departed' }),
  tpl({ code: 'transfer_act', title: ru('Акт приёма-передачи'), kind: 'document', beforePhase: 'departed' }),
  tpl({ code: 'ferry_ticket', title: ru('Фото билета / брони'), kind: 'photo', beforePhase: 'started', strictness: 'warn' }),
  tpl({ code: 'adr_parking', title: ru('Опасный груз: не останавливаться у жилых домов и АЗС'), kind: 'acknowledgement', beforePhase: 'arrived' }),
];

export const FUTURE_REQUIREMENT_RULES: RequirementRule[] = [
  { template: 'loading_process_photos', stageTypes: ['loading'] },
  { template: 'seal_number', stageTypes: ['loading'] },
  { template: 'cmr_signed', stageTypes: ['loading'] },
  { template: 'transfer_act', stageTypes: ['handover', 'takeover'] },
  { template: 'ferry_ticket', stageTypes: ['ferry_embark'] },
  { template: 'adr_parking', stageTypes: ['loading'], tagsRequired: ['adr'] },
];

/** Base catalog plus everything planned with the driver app. */
export const EXTENDED_CATALOG: Catalog = {
  stageTypes: BASE_CATALOG.stageTypes,
  eventTypes: { ...BASE_CATALOG.eventTypes, ...byCode(FUTURE_EVENT_TYPES) },
  incidentTypes: byCode(FUTURE_INCIDENT_TYPES),
  requirementTemplates: byCode(FUTURE_REQUIREMENT_TEMPLATES),
  requirementRules: FUTURE_REQUIREMENT_RULES,
};

