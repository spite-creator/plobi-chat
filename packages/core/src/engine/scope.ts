/**
 * Scope labels check: may this user submit this event on this stage right now?
 */
import type { EventScope, Role, StageKind, TransitMode } from '../catalog/types.js';
import type { Phase } from '../machines/phase.js';
import type { StageState } from '../machines/stage-state.js';

export type ScopeLabel =
  | 'kind'
  | 'stage_type'
  | 'transit_mode'
  | 'phase'
  | 'state'
  | 'role'
  | 'assignee'
  | 'tags_required'
  | 'tags_excluded';

export interface ScopeStage {
  readonly kind: StageKind;
  readonly typeCode: string;
  readonly transitMode?: TransitMode;
  readonly phase: Phase | null;
  readonly state: StageState;
  /** Trip tags plus stage tags. */
  readonly tags: ReadonlySet<string>;
  /** Stage assignee, or the trip driver. */
  readonly assigneeId?: string;
}

export interface ScopeSubject {
  readonly stage?: ScopeStage;
  readonly tags: ReadonlySet<string>;
  readonly role: Role;
  readonly userId: string;
  /** Dispatcher acting on behalf of the assignee bypasses role and assignee labels. */
  readonly forced: boolean;
}

/** Labels that only make sense on a stage. */
export function scopeNeedsStage(scope: EventScope | undefined): boolean {
  return !!scope && !!(scope.kinds || scope.stageTypes || scope.transitModes || scope.phases || scope.states);
}

const allowed = <T>(list: readonly T[] | undefined, value: T): boolean => !list || list.includes(value);

/** Returns the labels that do NOT match; empty means the event is in scope. */
export function checkScope(
  scope: EventScope | undefined,
  subject: ScopeSubject,
  defaults: { states?: readonly StageState[] } = {},
): ScopeLabel[] {
  const failed: ScopeLabel[] = [];
  const s = scope ?? {};
  const actingDispatcher = subject.forced && subject.role === 'dispatcher';

  if (!allowed(s.roles, subject.role) && !actingDispatcher) failed.push('role');

  const tags = subject.stage?.tags ?? subject.tags;
  if (s.tagsRequired && !s.tagsRequired.every((t) => tags.has(t))) failed.push('tags_required');
  if (s.tagsExcluded && s.tagsExcluded.some((t) => tags.has(t))) failed.push('tags_excluded');

  const stage = subject.stage;
  if (!stage) return failed;

  if (!allowed(s.kinds, stage.kind)) failed.push('kind');
  if (!allowed(s.stageTypes, stage.typeCode)) failed.push('stage_type');
  if (s.transitModes && (!stage.transitMode || !s.transitModes.includes(stage.transitMode))) {
    failed.push('transit_mode');
  }
  if (!allowed(s.phases, stage.phase)) failed.push('phase');
  if (!allowed(s.states ?? defaults.states, stage.state)) failed.push('state');

  const assigneeMismatch = subject.role === 'driver' && stage.assigneeId !== undefined && stage.assigneeId !== subject.userId;
  if (s.assigneeOnly && assigneeMismatch && !actingDispatcher) failed.push('assignee');

  return failed;
}
