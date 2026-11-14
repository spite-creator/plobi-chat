/**
 * When a catalog rule (requirement or instruction) is attached to a stage:
 * by stage type, trip/stage tags, customer and place. Empty = no restriction.
 */

export interface RuleScope {
  readonly stageTypes?: readonly string[];
  readonly tagsRequired?: readonly string[];
  /** Customer requirements: the rule applies only to trips of these customers. */
  readonly customers?: readonly string[];
  /** Place requirements: the rule applies only to stages at these places. */
  readonly places?: readonly string[];
}

export interface RuleSubject {
  readonly typeCode: string;
  readonly tags: ReadonlySet<string>;
  readonly customerId?: string;
  readonly placeId?: string;
}

const matches = (list: readonly string[] | undefined, value: string | undefined) =>
  !list || (value !== undefined && list.includes(value));

export function ruleApplies(scope: RuleScope, subject: RuleSubject): boolean {
  return (
    matches(scope.stageTypes, subject.typeCode) &&
    matches(scope.customers, subject.customerId) &&
    matches(scope.places, subject.placeId) &&
    (!scope.tagsRequired || scope.tagsRequired.every((t) => subject.tags.has(t)))
  );
}

/** The most specific condition names where the rule came from. */
export type RuleOrigin = 'customer' | 'place' | 'tag_rule' | 'stage_type';

export function ruleOrigin(scope: RuleScope): RuleOrigin {
  if (scope.customers) return 'customer';
  if (scope.places) return 'place';
  if (scope.tagsRequired) return 'tag_rule';
  return 'stage_type';
}

/** Trip-level facts a rule may depend on. */
export interface TripFacts {
  readonly tags?: readonly string[];
  readonly customerId?: string;
}

export interface StageFacts {
  readonly id: string;
  readonly typeCode: string;
  readonly tags?: readonly string[];
  readonly placeId?: string;
}

export function ruleSubject(stage: StageFacts, trip: TripFacts): RuleSubject {
  return {
    typeCode: stage.typeCode,
    tags: new Set([...(trip.tags ?? []), ...(stage.tags ?? [])]),
    customerId: trip.customerId,
    placeId: stage.placeId,
  };
}
