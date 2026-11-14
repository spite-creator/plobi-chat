/**
 * Who may see a trip and submit events on it.
 */
import type { Role } from '@plobi/core';
import { forbidden } from '../../platform/errors.js';
import type { AuthUser } from '../identity/service.js';

export interface TripParticipants {
  readonly driverId: string | null;
  readonly assigneeIds: readonly (string | null)[];
}

const isParticipant = (user: AuthUser, trip: TripParticipants) =>
  trip.driverId === user.id || trip.assigneeIds.includes(user.id);

export function canSeeTrip(user: AuthUser, trip: TripParticipants): boolean {
  return user.role !== 'driver' || isParticipant(user, trip);
}

export function assertCanSee(user: AuthUser, trip: TripParticipants): void {
  if (!canSeeTrip(user, trip)) throw forbidden('Not your trip');
}

export function assertCanSubmit(user: AuthUser, trip: TripParticipants): void {
  if (user.role === 'observer') throw forbidden('Observers cannot submit events');
  assertCanSee(user, trip);
}

/** Role as the engine knows it: administrators act as dispatchers. */
export function engineRole(user: AuthUser): Role {
  return user.role === 'admin' ? 'dispatcher' : user.role;
}
