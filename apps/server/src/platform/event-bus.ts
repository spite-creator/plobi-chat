/**
 * In-process bus for domain events between modules.
 *
 * A module publishes what happened ("trip.events_applied"); other modules
 * subscribe without the publisher knowing about them. Webhooks will use the
 * same events later.
 */

export interface DomainEvents {
  'trip.created': { tripId: string };
  'trip.events_applied': { tripId: string; eventIds: string[] };
  'catalog.changed': Record<string, never>;
}

export type DomainEventName = keyof DomainEvents;
type Listener<K extends DomainEventName> = (payload: DomainEvents[K]) => void | Promise<void>;

export class EventBus {
  private readonly listeners = new Map<DomainEventName, Listener<never>[]>();

  constructor(private readonly onError: (error: unknown, event: DomainEventName) => void) {}

  on<K extends DomainEventName>(event: K, listener: Listener<K>): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as Listener<never>);
    this.listeners.set(event, list);
  }

  /** Listeners run after the publisher's work is committed; a failing listener never breaks the publisher. */
  async publish<K extends DomainEventName>(event: K, payload: DomainEvents[K]): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        await (listener as Listener<K>)(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }
}
