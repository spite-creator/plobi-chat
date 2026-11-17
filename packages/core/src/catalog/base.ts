/**
 * Base catalog shipped with the product (docs/base-catalog.md): the stage
 * types and the clean set of base events. Each event sets a stage one phase or
 * details it; an external system maps its own items onto these events, and the
 * engine accepts them or not. Companies rename, hide or extend the catalog;
 * the machines stay the same.
 *
 * What is planned together with the driver app lives in future.ts.
 */
import type { Catalog, EventScope, EventType, Fault, Placement, StageType } from './types.js';

export const ru = (text: string) => ({ ru: text });
export const byCode = <T extends { code: string }>(items: readonly T[]): Record<string, T> =>
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
 * - Is it planned? Checks, weighing, crew change, trailer drop are not points but events.
 * - Does the driver stay with the cargo? Yes (on the ferry with the tractor) → ferry_embark /
 *   ferry_disembark. No (warehouse, ship, train, plane) → handover / takeover: the one who carries
 *   the cargo changes, no transit in between, the handover ends a segment of the route.
 */
export const STAGE_TYPES: StageType[] = [
  point('depot', 'База / гараж', 'point_simple', 'allow'),
  point('loading', 'Погрузка', 'point_split', 'with_reason'),
  point('export_clearance', 'Затаможка', 'point_split', 'deny'),
  point('border_exit', 'Выезд через погранпереход', 'point_single', 'deny'),
  point('border_entry', 'Въезд через погранпереход', 'point_single', 'deny'),
  point('border_open', 'Быстрый погранпереход', 'point_mark', 'allow'),
  point('ferry_embark', 'Заезд на паром', 'point_single', 'with_reason'),
  point('ferry_disembark', 'Съезд с парома', 'point_simple', 'allow'),
  point('handover', 'Сдача груза', 'point_split', 'with_reason', { noTransitAfter: true, endsSegment: true }),
  point('takeover', 'Приём груза', 'point_split', 'with_reason'),
  point('import_clearance', 'Растаможка', 'point_split', 'deny'),
  point('unloading', 'Выгрузка', 'point_split', 'with_reason'),
  point('waypoint', 'Промежуточная точка', 'point_simple', 'allow'),
  { code: 'transit', name: ru('Транзит'), kind: 'transit', profile: 'transit' },
];

export const POINT_TYPES = STAGE_TYPES.filter((s) => s.kind === 'point').map((s) => s.code);
export const ALL_STAGE_TYPES = STAGE_TYPES.map((s) => s.code);
const BORDER_POSTS = ['border_exit', 'border_entry'];

// ---------- events ----------

/** Who may submit base events: the stage's driver, the dispatcher, an integration. */
export const ANYONE: EventScope['roles'] = ['driver', 'dispatcher', 'integration'];

/** A base event: a phase event if it sets a phase, otherwise a detail. Only the stage's assignee moves its phase. */
export const event = (
  code: string,
  name: string,
  placement: Placement,
  scope: Omit<EventScope, 'roles'>,
  setsPhase?: EventType['setsPhase'],
  extra: Partial<EventType> = {},
): EventType => ({
  code,
  name: ru(name),
  action: setsPhase ? 'phase' : 'detail',
  placement,
  ...(setsPhase ? { setsPhase } : {}),
  scope: { roles: ANYONE, ...(setsPhase ? { assigneeOnly: true } : {}), ...scope },
  ...extra,
});

const at = (...stageTypes: string[]) => ({ stageTypes });

/** A stop: the event itself is the reason of the pause. Road stops only on a transit. */
const stop = (code: string, name: string, placement: Placement, defaultFault?: Fault): EventType =>
  event(code, name, placement, placement === 'road' ? { kinds: ['transit'] } : {}, 'paused', defaultFault ? { defaultFault } : {});

export const BASE_EVENT_TYPES: EventType[] = [
  event('arrived', 'Прибыл', 'point', at(...POINT_TYPES), 'arrived'),
  event('departed', 'Убыл', 'point', at(...POINT_TYPES.filter((t) => !BORDER_POSTS.includes(t) && t !== 'border_open')), 'departed'),
  event('loading_started', 'Начали загружать', 'point', at('loading'), 'started'),
  event('loaded', 'Загружен, ожидаю документы', 'point', at('loading'), 'completed'),
  event('documents_received', 'Документы получил', 'point', at('loading')),
  event('export_clearance_started', 'Начали оформление', 'point', at('export_clearance'), 'started'),
  event('export_cleared', 'Затаможен', 'point', at('export_clearance'), 'completed'),
  event('border_control_started', 'Начат пограничный контроль', 'point', at(...BORDER_POSTS), 'started'),
  event('border_crossed', 'Пересёк границу', 'point', at(...BORDER_POSTS, 'border_open'), 'departed'),
  event('import_clearance_started', 'Начали оформление', 'point', at('import_clearance'), 'started'),
  event('import_cleared', 'Растаможен', 'point', at('import_clearance'), 'completed'),
  event('unloading_started', 'Начали выгружать', 'point', at('unloading'), 'started'),
  event('unloaded', 'Выгружен', 'point', at('unloading'), 'completed'),
  event('handover_started', 'Начал сдачу', 'point', at('handover'), 'started'),
  event('handed_over', 'Сдал груз', 'point', at('handover'), 'completed'),
  event('takeover_started', 'Начал приём', 'point', at('takeover'), 'started'),
  event('taken_over', 'Принял груз', 'point', at('takeover'), 'completed'),
  // Heartbeat: the vehicle is alive and moving; the only event that may be repeated.
  event('in_transit', 'В пути', 'road', {}, 'started'),

  // Stops: each pauses mid-work or mid-move; the reason is the event itself.
  stop('downtime', 'Простой', 'here'),
  stop('rest', 'Отдых', 'road'),
  stop('repair', 'Ремонт', 'road', 'carrier'),
  stop('traffic_ban', 'Запрет движения', 'road', 'external'),
  stop('bad_weather', 'Непогода', 'road', 'external'),
  stop('inspection', 'Досмотр', 'road', 'external'),
  stop('accident', 'ДТП', 'road'),
  event('resumed', 'Продолжил', 'here', {}, 'resumed'),

  // General "started" / "completed" bound to no stage type: attach them to stages without their own wording.
  event('work_started', 'Начато', 'point', at(), 'started'),
  event('work_finished', 'Завершено', 'point', at(), 'completed'),
];

export const BASE_CATALOG: Catalog = {
  stageTypes: byCode(STAGE_TYPES),
  eventTypes: byCode(BASE_EVENT_TYPES),
  incidentTypes: {},
  requirementTemplates: {},
  requirementRules: [],
};
