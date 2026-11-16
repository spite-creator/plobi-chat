/**
 * Integrations send points only; transits between them are inserted here.
 */
import type { Catalog, TransportMode } from '../catalog/types.js';
import type { StageInput } from './types.js';

/**
 * How two neighbouring points are connected: a transit with its transport
 * mode, or nothing (after a handover the cargo is with a third party until the
 * takeover, and nobody of ours moves it).
 */
export type TransitRule = (from: StageInput, to: StageInput, catalog: Catalog) => { mode: TransportMode } | null;

export const defaultTransitRule: TransitRule = (from, to, catalog) => {
  if (catalog.stageTypes[from.typeCode]?.noTransitAfter) return null;
  if (from.typeCode === 'ferry_embark' && to.typeCode === 'ferry_disembark') return { mode: 'ferry' };
  return { mode: 'road' };
};

/** Code of the stage type used for inserted transits. */
export const TRANSIT_TYPE = 'transit';

/**
 * Inserts an automatic transit between every two neighbouring points.
 * Explicit transits passed by the caller are kept as they are.
 */
export function insertTransits(
  stages: readonly StageInput[],
  catalog: Catalog,
  rule: TransitRule = defaultTransitRule,
): StageInput[] {
  const isPoint = (s: StageInput) => catalog.stageTypes[s.typeCode]?.kind === 'point';
  const result: StageInput[] = [];
  stages.forEach((stage, i) => {
    const prev = stages[i - 1];
    const link = prev && isPoint(prev) && isPoint(stage) ? rule(prev, stage, catalog) : null;
    if (prev && link) {
      result.push({ id: `${prev.id}~${stage.id}`, typeCode: TRANSIT_TYPE, mode: link.mode, isAuto: true });
    }
    result.push(stage);
  });
  return result;
}
