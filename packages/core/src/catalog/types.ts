/**
 * Catalog: what a company configures. Stage types, event types (with scope
 * labels and fields), incident types, requirement templates and tag rules.
 * Everything here is data, not code.
 */
import type { Phase, Profile } from '../machines/phase.js';
import type { StageState } from '../machines/stage-state.js';

export type StageKind = 'point' | 'transit';
export type TransitMode = 'road' | 'ferry' | 'rail';
export type Role = 'driver' | 'dispatcher' | 'observer' | 'integration' | 'system';
export type LocalizedText = Readonly<Record<string, string>>;

/** May a point be left right after arrival, without doing the work? */
export type DepartWithoutWork = 'allow' | 'with_reason' | 'deny';

export interface StageType {
  readonly code: string;
  readonly name: LocalizedText;
  readonly kind: StageKind;
  readonly profile: Profile;
  readonly transitMode?: TransitMode;
  readonly departWithoutWork?: DepartWithoutWork;
}

/** What an event does. Each action has its own handler in the engine. */
export type EventAction =
  | 'phase' // moves the phase machine
  | 'detail' // adds information / evidence, phase unchanged
  | 'skip' // stage → skipped
  | 'waive' // removes a requirement from a stage
  | 'incident_open'
  | 'incident_ack'
  | 'incident_resolve'
  | 'trip_accept'
  | 'trip_close'
  | 'trip_cancel';

/** Scope labels: where and by whom the event may be submitted. Empty = no restriction. */
export interface EventScope {
  readonly kinds?: readonly StageKind[];
  readonly stageTypes?: readonly string[];
  readonly transitModes?: readonly TransitMode[];
  readonly phases?: readonly (Phase | null)[];
  readonly states?: readonly StageState[];
  readonly roles?: readonly Role[];
  readonly assigneeOnly?: boolean;
  readonly tagsRequired?: readonly string[];
  readonly tagsExcluded?: readonly string[];
}

export const FIELD_KINDS = [
  'text',
  'number',
  'select',
  'multiselect',
  'datetime',
  'checklist',
  'scan',
  'photo',
  'video',
  'document',
  'signature',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** A field of the event form shown to the user. */
export interface EventField {
  readonly key: string;
  readonly kind: FieldKind;
  readonly label?: LocalizedText;
  readonly required?: boolean;
  /** For attachment fields: minimum number of files when required. */
  readonly min?: number;
  readonly max?: number;
  readonly cameraOnly?: boolean;
  readonly options?: readonly string[];
  /** Field is shown (and required) only when all these values match. */
  readonly showIf?: Readonly<Record<string, unknown>>;
}

export interface EventType {
  readonly code: string;
  readonly name: LocalizedText;
  readonly action: EventAction;
  /** For action = phase. */
  readonly setsPhase?: Phase;
  /** For incident actions. */
  readonly incidentType?: string;
  readonly scope?: EventScope;
  readonly fields?: readonly EventField[];
  readonly severity?: 'info' | 'warning' | 'critical';
}

export interface IncidentType {
  readonly code: string;
  readonly name: LocalizedText;
  readonly blocksProgress: boolean;
  readonly autoPause: boolean;
  readonly severity: 'warning' | 'critical';
}

export const REQUIREMENT_KINDS = [
  'photo',
  'video',
  'document',
  'signature',
  'scan',
  'number',
  'text',
  'checklist',
  'event',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Something that must be collected on a stage before it enters a phase. */
export interface RequirementSpec {
  readonly title: LocalizedText;
  readonly kind: RequirementKind;
  readonly beforePhase: Phase;
  /** Evidence counts only if captured after this phase was reached. */
  readonly captureFromPhase?: Phase;
  readonly min?: number;
  readonly cameraOnly?: boolean;
  /** kind = event: this event type must have been submitted on the stage. */
  readonly eventType?: string;
  /** kind = scan | number | text | checklist: the event value key that holds it. */
  readonly valueKey?: string;
  readonly strictness: 'block' | 'warn';
  readonly waivable: boolean;
  readonly instructions?: LocalizedText;
}

export interface RequirementTemplate extends RequirementSpec {
  readonly code: string;
}

/** When a template is attached to stages automatically. */
export interface RequirementRule {
  readonly template: string;
  readonly stageTypes?: readonly string[];
  readonly tagsRequired?: readonly string[];
}

export interface Catalog {
  readonly stageTypes: Readonly<Record<string, StageType>>;
  readonly eventTypes: Readonly<Record<string, EventType>>;
  readonly incidentTypes: Readonly<Record<string, IncidentType>>;
  readonly requirementTemplates: Readonly<Record<string, RequirementTemplate>>;
  readonly requirementRules: readonly RequirementRule[];
}
