/**
 * "What can I do now?" — the buttons a user sees on a stage.
 *
 * Every event type is probed against the current run. Unmet blocking
 * requirements do not hide a button; they are returned so the UI can show the
 * transition checklist.
 */
import type { Catalog, Role } from '../catalog/types.js';
import { check, replay } from './evaluate.js';
import { isPassed } from './placement.js';
import type { TripRun } from './run.js';

import type { EventInput, TripInput } from './types.js';

/** Where the vehicle is: the cursor's stage, or the next one if that is passed. */
function currentStageId(run: TripRun): string | undefined {
  let i = Math.max(run.cursor, 0);
  while (run.stages[i] && isPassed(run.stages[i]!) && i + 1 < run.stages.length) i++;
  return run.stages[i]?.input.id;
}

export interface AvailableQuery {
  readonly role: Role;
  readonly userId: string;
  readonly stageId?: string;
  /** Time of the probe, ISO-8601. */
  readonly at: string;
  /** Probe as a dispatcher acting on behalf of the assignee. */
  readonly forced?: boolean;
}

export interface AvailableEvent {
  readonly typeCode: string;
  readonly stageId?: string;
  readonly requirementsUnmet: readonly string[];
}

/**
 * Only events that would land on the asked stage (or, without one, on the
 * current stage) are buttons there: "unloaded" pressed at the loading would be
 * placed on the unloading, which is not what the driver means. Trip-level
 * events (no stage) are always listed.
 */
export function availableEvents(
  trip: TripInput,
  events: readonly EventInput[],
  catalog: Catalog,
  query: AvailableQuery,
): AvailableEvent[] {
  const { run } = replay(trip, events, catalog);
  const result: AvailableEvent[] = [];
  const target = query.stageId ?? currentStageId(run);

  for (const type of Object.values(catalog.eventTypes)) {
    const probe: EventInput = {
      id: '__probe__',
      typeCode: type.code,
      occurredAt: query.at,
      authorId: query.userId,
      authorRole: query.role,
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.forced ? { forced: true } : {}),
    };
    const outcome = check(run, probe, 'probe');
    if (outcome.ok && (outcome.stageId === undefined || outcome.stageId === target)) {
      result.push({
        typeCode: type.code,
        ...(outcome.stageId ? { stageId: outcome.stageId } : {}),
        requirementsUnmet: outcome.requirementsUnmet ?? [],
      });
    }
  }
  return result;
}
