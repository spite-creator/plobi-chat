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

/**
 * Kinds of requirements. A requirement is one item on a stage that the driver
 * sees and works with: just read it, acknowledge it, or provide something.
 */
export const REQUIREMENT_KINDS = [
  'info', // read: "Call Ashot, he opens the gate"
  'acknowledgement', // read and confirm "Acknowledged": "No more than 2 tiers"
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

/** When the app shows a requirement: from assignment, or from reaching a phase. */
export const SHOW_AT = ['always', 'arrived', 'started', 'completed'] as const;
export type ShowAt = (typeof SHOW_AT)[number];

/** What is shown to the driver with a requirement, besides its title. */
export interface RequirementContent {
  readonly text?: LocalizedText | string;
  readonly contact?: { readonly name: string; readonly phone: string; readonly role?: string };
  readonly location?: { readonly lat: number; readonly lon: number };
  /** Photos of the gate, a route scheme, a voice note... */
  readonly attachmentIds?: readonly string[];
  readonly url?: string;
}

export interface RequirementSpec extends RequirementContent {
  readonly title: LocalizedText | string;
  readonly kind: RequirementKind;
  /** Default: always. */
  readonly showAt?: ShowAt;
  /** Must be fulfilled before the stage enters this phase. Not used for kind = info. */
  readonly beforePhase?: Phase;
  /** Evidence counts only if captured after this phase was reached. */
  readonly captureFromPhase?: Phase;
  readonly min?: number;
  readonly cameraOnly?: boolean;
  /** kind = event: this event type must have been submitted on the stage. */
  readonly eventType?: string;
  /** kind = scan | number | text | checklist: the event value key that holds it. */
  readonly valueKey?: string;
  /** Default: block. */
  readonly strictness?: 'block' | 'warn';
  /** Default: true. */
  readonly waivable?: boolean;
}

export interface RequirementTemplate extends RequirementSpec {
  readonly code: string;
}

/** Default requirements: added to every stage of these types (optionally only with these tags). */
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
