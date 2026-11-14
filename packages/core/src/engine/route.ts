/**
 * Integrations send points only; transits between them are inserted here.
 */
import type { Catalog } from '../catalog/types.js';
import type { StageInput } from './types.js';

/** Which transit connects two neighbouring points. */
export type TransitRule = (from: StageInput, to: StageInput) => string;

export const defaultTransitRule: TransitRule = (from, to) => {
  if (from.typeCode === 'ferry_port_departure' && to.typeCode === 'ferry_port_arrival') return 'transit_ferry';
  if (from.typeCode === 'rail_terminal_departure' && to.typeCode === 'rail_terminal_arrival') return 'transit_rail';
  return 'transit_road';
};

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
    if (prev && isPoint(prev) && isPoint(stage)) {
      result.push({ id: `${prev.id}~${stage.id}`, typeCode: rule(prev, stage), isAuto: true });
    }
    result.push(stage);
  });
  return result;
}
