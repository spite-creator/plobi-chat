import {
  BASE_CATALOG,
  insertTransits,
  materializeRequirements,
  type Attachment,
  type Catalog,
  type EventInput,
  type Role,
  type StageInput,
  type TripInput,
} from '../src/index.js';

export const START = Date.parse('2026-11-20T06:00:00Z');
export const minutes = (m: number) => new Date(START + m * 60_000).toISOString();

/** A trip from points: transits are inserted, requirements materialized from the catalog. */
export function buildTrip(
  points: ReadonlyArray<{ id: string; typeCode: string; tags?: string[] }>,
  options: { tags?: string[]; driverId?: string; catalog?: Catalog } = {},
): TripInput {
  const catalog = options.catalog ?? BASE_CATALOG;
  const tags = options.tags ?? [];
  const stages: StageInput[] = insertTransits(points, catalog).map((s) =>
    catalog.stageTypes[s.typeCode]?.kind === 'point' ? { ...s, requirements: materializeRequirements(s, { tags }, catalog) } : s,
  );
  return { id: 'trip-1', driverId: options.driverId ?? 'driver-1', tags, stages };
}

type Extra = Partial<Omit<EventInput, 'typeCode' | 'stageId' | 'authorRole'>>;

/** Event journal with a clock that moves forward by default 10 minutes per event. */
export class Journal {
  readonly events: EventInput[] = [];
  private clock = 0;
  private seq = 0;

  at(minute: number): this {
    this.clock = minute;
    return this;
  }

  add(role: Role, typeCode: string, stageId?: string, extra: Extra = {}): EventInput {
    const ev: EventInput = {
      id: `e${String(++this.seq).padStart(3, '0')}`,
      typeCode,
      occurredAt: minutes(this.clock),
      authorId: role === 'driver' ? 'driver-1' : 'disp-1',
      authorRole: role,
      ...(stageId ? { stageId } : {}),
      ...extra,
    };
    this.clock += 10;
    this.events.push(ev);
    return ev;
  }

  driver(typeCode: string, stageId?: string, extra?: Extra) {
    return this.add('driver', typeCode, stageId, extra);
  }

  dispatcher(typeCode: string, stageId?: string, extra?: Extra) {
    return this.add('dispatcher', typeCode, stageId, extra);
  }
}

let fileSeq = 0;
export function photos(requirementId: string, count: number, overrides: Partial<Attachment> = {}): Attachment[] {
  return Array.from({ length: count }, () => ({
    id: `f${++fileSeq}`,
    kind: 'photo' as const,
    source: 'camera' as const,
    field: 'photos',
    requirementId,
    ...overrides,
  }));
}

export function document(requirementId: string): Attachment[] {
  return [{ id: `f${++fileSeq}`, kind: 'document', source: 'camera', field: 'documents', requirementId }];
}

/** Points named by their type, numbered when a type repeats: route('loading', 'unloading'). */
export function route(...types: string[]): Array<{ id: string; typeCode: string }> {
  const seen = new Map<string, number>();
  return types.map((typeCode) => {
    const n = (seen.get(typeCode) ?? 0) + 1;
    seen.set(typeCode, n);
    return { id: n === 1 ? typeCode : `${typeCode}${n}`, typeCode };
  });
}
