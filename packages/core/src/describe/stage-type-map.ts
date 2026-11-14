/**
 * Map of a stage type for the admin: its phase machine with, on every
 * transition, the events that perform it, who may submit them and which
 * requirements gate it; plus detail events available in each phase.
 */
import type { Catalog, EventType, RequirementTemplate, Role, StageType } from '../catalog/types.js';
import { PHASE_RANK, PROFILE_PHASES, profileTransitions, type Phase } from '../machines/phase.js';

export interface TransitionMap {
  readonly from: Phase | null;
  readonly to: Phase;
  /** Done automatically at a stage boundary, not by a button. */
  readonly automatic: boolean;
  readonly events: ReadonlyArray<{ code: string; roles: readonly Role[] | 'any' }>;
  readonly requirements: readonly RequirementTemplate[];
}

export interface StageTypeMap {
  readonly stageType: StageType;
  readonly transitions: readonly TransitionMap[];
  readonly detailEvents: ReadonlyArray<{ phase: Phase; events: readonly string[] }>;
}

/** Does an event's scope admit this stage type? Tags are runtime and ignored here. */
export function eventFitsStageType(event: EventType, stageType: StageType): boolean {
  const s = event.scope ?? {};
  return (
    (!s.kinds || s.kinds.includes(stageType.kind)) &&
    (!s.stageTypes || s.stageTypes.includes(stageType.code)) &&
    (!s.transitModes || (stageType.transitMode !== undefined && s.transitModes.includes(stageType.transitMode)))
  );
}

const fitsPhase = (event: EventType, phase: Phase | null) => !event.scope?.phases || event.scope.phases.includes(phase);

/** Transit start and end happen at the neighbouring points' boundaries. */
function isAutomatic(stageType: StageType, from: Phase | null, to: Phase): boolean {
  return stageType.kind === 'transit' && ((from === null && to === 'started') || to === 'completed');
}

export function stageTypeMap(catalog: Catalog, stageTypeCode: string): StageTypeMap | undefined {
  const stageType = catalog.stageTypes[stageTypeCode];
  if (!stageType) return undefined;

  const events = Object.values(catalog.eventTypes).filter((e) => eventFitsStageType(e, stageType));
  const templates = catalog.requirementRules
    .filter((r) => !r.stageTypes || r.stageTypes.includes(stageType.code))
    .map((r) => catalog.requirementTemplates[r.template])
    .filter((t): t is RequirementTemplate => t !== undefined);

  const transitions = profileTransitions(stageType.profile).map((t): TransitionMap => {
    const gatedHere = templates.filter(({ beforePhase }) => {
      if (!beforePhase) return false;
      const reached = PHASE_RANK[t.to] >= PHASE_RANK[beforePhase];
      const before = t.from === null || PHASE_RANK[t.from] < PHASE_RANK[beforePhase];
      return reached && before;
    });
    return {
      from: t.from,
      to: t.to,
      automatic: isAutomatic(stageType, t.from, t.to),
      events: events
        .filter((e) => e.action === 'phase' && e.setsPhase === t.to && fitsPhase(e, t.from))
        .map((e) => ({ code: e.code, roles: e.scope?.roles ?? 'any' })),
      requirements: gatedHere,
    };
  });

  const detailEvents = PROFILE_PHASES[stageType.profile].map((phase) => ({
    phase,
    events: events.filter((e) => e.action === 'detail' && fitsPhase(e, phase)).map((e) => e.code),
  }));

  return { stageType, transitions, detailEvents };
}
