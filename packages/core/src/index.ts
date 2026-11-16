/**
 * @plobi/core — the domain core shared by the server and the PWA.
 * Pure functions only: no I/O, no clock, no framework.
 */

// machines
export * from './machines/phase.js';
export * from './machines/stage-state.js';
export * from './machines/trip-state.js';

// catalog
export * from './catalog/types.js';
export { BASE_CATALOG } from './catalog/base.js';
export { validateCatalog, type CatalogIssue } from './catalog/validate.js';

// engine
export * from './engine/types.js';
export { evaluateTrip, orderEvents } from './engine/evaluate.js';
export { availableEvents, type AvailableEvent, type AvailableQuery } from './engine/available.js';
export { ACKNOWLEDGE_EVENT, isVisible, materializeRequirements } from './engine/requirements.js';
export { insertTransits, defaultTransitRule, TRANSIT_TYPE, type TransitRule } from './engine/route.js';
export { missingFields } from './engine/fields.js';
export { checkScope, type ScopeLabel } from './engine/scope.js';
export { UnknownStageTypeError } from './engine/run.js';

// describe (admin "Automata" section)
export { phaseDiagram, stageStateDiagram, tripStateDiagram, describeMachines } from './describe/diagrams.js';
export { stageTypeMap, type StageTypeMap, type TransitionMap } from './describe/stage-type-map.js';
