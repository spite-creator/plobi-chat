/**
 * Engine input (a trip and its event journal) and output (computed state).
 * Times are ISO-8601 strings in UTC.
 */
import type { RuleOrigin } from '../catalog/rule-scope.js';
import type { InstructionContent, RequirementSpec, Role, StageKind } from '../catalog/types.js';
import type { Phase, Profile } from '../machines/phase.js';
import type { StageState } from '../machines/stage-state.js';
import type { TripState } from '../machines/trip-state.js';

// ---------- input ----------

export interface StageRequirement extends RequirementSpec {
  readonly id: string;
  readonly source: RuleOrigin | 'instruction' | 'manual';
  readonly template?: string;
}

export interface StageInstruction extends InstructionContent {
  readonly id: string;
  /** Grows on every change; an acknowledgement counts only for the current revision. */
  readonly revision: number;
  /** `place` = permanent instruction of the place card; others = catalog rules or manual. */
  readonly source: RuleOrigin | 'manual';
}

export interface StageInput {
  readonly id: string;
  readonly typeCode: string;
  readonly placeId?: string;
  readonly assigneeId?: string;
  readonly tags?: readonly string[];
  readonly requirements?: readonly StageRequirement[];
  readonly instructions?: readonly StageInstruction[];
  readonly isAuto?: boolean;
}

export interface TripInput {
  readonly id: string;
  readonly driverId?: string;
  readonly customerId?: string;
  readonly tags?: readonly string[];
  readonly stages: readonly StageInput[];
}

export interface Attachment {
  readonly id: string;
  readonly kind: 'photo' | 'video' | 'document' | 'signature';
  readonly source: 'camera' | 'gallery' | 'api';
  /** When the file was captured; defaults to the event time. */
  readonly capturedAt?: string;
  /** Event form field the file belongs to. */
  readonly field?: string;
  /** Stage requirement the file is evidence for. */
  readonly requirementId?: string;
}

export interface EventInput {
  /** Generated on the client, so offline retries are idempotent. */
  readonly id: string;
  readonly typeCode: string;
  readonly stageId?: string;
  readonly occurredAt: string;
  readonly receivedAt?: string;
  readonly authorId: string;
  readonly authorRole: Role;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly attachments?: readonly Attachment[];
  /** Dispatcher acts on behalf of the assignee; requires values.reason. */
  readonly forced?: boolean;
  /** Driver chose to proceed although blocking requirements are unmet (offline). */
  readonly acceptUnmet?: boolean;
}

// ---------- output ----------

export type ConflictReason =
  | 'unknown_event_type'
  | 'stage_required'
  | 'stage_not_found'
  | 'out_of_scope'
  | 'stage_closed'
  | 'invalid_transition'
  | 'reason_required'
  | 'order_violation'
  | 'blocked_by_incident'
  | 'requirements_unmet'
  | 'invalid_values'
  | 'incident_not_found'
  | 'requirement_not_found'
  | 'trip_not_finished'
  | 'trip_locked';

export interface Conflict {
  readonly reason: ConflictReason;
  readonly details?: readonly string[];
}

export interface EventResult {
  readonly eventId: string;
  readonly typeCode: string;
  readonly result: 'applied' | 'conflict';
  readonly conflict?: Conflict;
  /** Blocking requirements passed over (acceptUnmet or forced). */
  readonly requirementsUnmet?: readonly string[];
  /** Warn-level requirements that were not met. */
  readonly warnings?: readonly string[];
  /** Automatic changes caused by the event, e.g. "stage:s2 started". */
  readonly effects: readonly string[];
}

export interface Pause {
  readonly from: string;
  readonly to?: string;
  readonly reason?: string;
  readonly incidentId?: string;
}

export interface RequirementStatus {
  readonly id: string;
  readonly title: RequirementSpec['title'];
  readonly beforePhase: Phase;
  readonly strictness: 'block' | 'warn';
  readonly fulfilled: boolean;
  readonly have: number;
  readonly need: number;
  readonly waived: boolean;
  /** The gated phase was entered while this requirement was unmet. */
  readonly violated: boolean;
  /** The stage was left without the work, so the requirement did not apply. */
  readonly notApplicable: boolean;
}

export interface InstructionStatus {
  readonly id: string;
  readonly revision: number;
  /** The app shows it now (its show_at phase is reached). */
  readonly visible: boolean;
  /** Acknowledged in its current revision (only for instructions that require it). */
  readonly acknowledged?: boolean;
}

export interface StageResult {
  readonly id: string;
  readonly typeCode: string;
  readonly kind: StageKind;
  readonly profile: Profile;
  readonly state: StageState;
  readonly phase: Phase | null;
  readonly arrivedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly departedAt?: string;
  readonly pauses: readonly Pause[];
  /** Sum of closed pauses, milliseconds. */
  readonly pausedMs: number;
  readonly requirements: readonly RequirementStatus[];
  readonly instructions: readonly InstructionStatus[];
}

export interface IncidentResult {
  readonly id: string;
  readonly typeCode: string;
  readonly stageId?: string;
  readonly state: 'open' | 'acknowledged' | 'resolved';
  readonly blocksProgress: boolean;
  readonly openedAt: string;
  readonly resolvedAt?: string;
}

export interface TripResult {
  readonly state: TripState;
  readonly currentStageId?: string;
  readonly stages: readonly StageResult[];
  /** In replay order (by occurredAt). */
  readonly events: readonly EventResult[];
  readonly incidents: readonly IncidentResult[];
}
