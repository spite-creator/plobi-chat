/**
 * "What can I do now?" — the buttons a user sees on a stage.
 *
 * Every event type is probed against the current run. Unmet blocking
 * requirements do not hide a button; they are returned so the UI can show the
 * transition checklist.
 */
import type { Catalog, Role } from '../catalog/types.js';
import { check, replay } from './evaluate.js';
import type { EventInput, TripInput } from './types.js';

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

export function availableEvents(
  trip: TripInput,
  events: readonly EventInput[],
  catalog: Catalog,
  query: AvailableQuery,
): AvailableEvent[] {
  const { run } = replay(trip, events, catalog);
  const result: AvailableEvent[] = [];

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
    if (outcome.ok) {
      result.push({
        typeCode: type.code,
        ...(query.stageId ? { stageId: query.stageId } : {}),
        requirementsUnmet: outcome.requirementsUnmet ?? [],
      });
    }
  }
  return result;
}
