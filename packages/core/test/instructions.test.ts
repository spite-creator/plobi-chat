import { describe, expect, it } from 'vitest';
import {
  BASE_CATALOG,
  evaluateTrip,
  materializeInstructions,
  materializeRequirements,
  type Place,
  type StageInstruction,
  type TripInput,
} from '../src/index.js';
import { Journal } from './helpers.js';

const warehouse: Place = {
  id: 'wh-north',
  name: 'Склад «Северный»',
  instructions: [
    { id: 'call', kind: 'contact', contact: { name: 'Ашот', phone: '+7 900 000-00-00', role: 'охрана' }, showAt: 'always' },
    { id: 'gate', kind: 'text', text: 'Приедешь — позвони Ашоту, он откроет ворота', showAt: 'arrived' },
  ],
};

const noTiers: StageInstruction = {
  id: 'load:manual:tiers',
  kind: 'text',
  text: 'Не грузить выше 2 ярусов',
  showAt: 'arrived',
  ackBeforePhase: 'started',
  revision: 1,
  source: 'manual',
};

/** A loading stage with only the given instructions (no catalog requirements, to isolate the behaviour). */
const tripWith = (instructions: StageInstruction[]): TripInput => ({
  id: 't',
  driverId: 'driver-1',
  stages: [{ id: 'load', typeCode: 'loading', instructions, requirements: [] }],
});

describe('where instructions come from', () => {
  it('a stage gets the place instructions and the catalog rules for its tags', () => {
    const list = materializeInstructions({ id: 'load', typeCode: 'loading' }, { tags: ['adr'] }, BASE_CATALOG, warehouse);
    expect(list.map((i) => [i.id, i.source])).toEqual([
      ['load:place:call', 'place'],
      ['load:place:gate', 'place'],
      ['load:rule:adr_parking', 'tag_rule'],
    ]);
  });

  it('a #reefer rule applies only to loadings', () => {
    const atLoading = materializeInstructions({ id: 'l', typeCode: 'loading' }, { tags: ['reefer'] }, BASE_CATALOG);
    const atUnloading = materializeInstructions({ id: 'u', typeCode: 'unloading' }, { tags: ['reefer'] }, BASE_CATALOG);
    expect(atLoading.map((i) => i.id)).toEqual(['l:rule:reefer_check']);
    expect(atUnloading).toEqual([]);
  });
});

describe('when instructions are shown', () => {
  const place = materializeInstructions({ id: 'load', typeCode: 'loading' }, {}, BASE_CATALOG, warehouse);

  it('"always" is visible from assignment; "arrived" appears after arrival', () => {
    const before = evaluateTrip(tripWith(place), [], BASE_CATALOG).stages[0]?.instructions;
    expect(before?.map((i) => [i.id, i.visible])).toEqual([
      ['load:place:call', true],
      ['load:place:gate', false],
    ]);

    const j = new Journal();
    j.driver('arrived', 'load');
    const after = evaluateTrip(tripWith(place), j.events, BASE_CATALOG).stages[0]?.instructions;
    expect(after?.every((i) => i.visible)).toBe(true);
  });
});

describe('"Acknowledged" is a requirement', () => {
  it('blocks the start of work until acknowledged', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const start = j.driver('loading_started', 'load');
    const r = evaluateTrip(tripWith([noTiers]), j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === start.id)?.conflict).toEqual({
      reason: 'requirements_unmet',
      details: ['load:manual:tiers:ack'],
    });
    expect(r.stages[0]?.instructions[0]?.acknowledged).toBe(false);
  });

  it('acknowledging lets the work start', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('instruction_acknowledged', 'load', { values: { instructionId: noTiers.id, revision: 1 } });
    j.driver('loading_started', 'load');
    const r = evaluateTrip(tripWith([noTiers]), j.events, BASE_CATALOG);
    expect(r.events.every((e) => e.result === 'applied')).toBe(true);
    expect(r.stages[0]?.instructions[0]?.acknowledged).toBe(true);
  });

  it('can be acknowledged before arrival', () => {
    const j = new Journal();
    const ack = j.driver('instruction_acknowledged', 'load', { values: { instructionId: noTiers.id, revision: 1 } });
    const r = evaluateTrip(tripWith([noTiers]), j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === ack.id)?.result).toBe('applied');
  });

  it('a changed instruction must be acknowledged again', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('instruction_acknowledged', 'load', { values: { instructionId: noTiers.id, revision: 1 } });
    const start = j.driver('loading_started', 'load');
    const changed = { ...noTiers, text: 'Не грузить выше 1 яруса', revision: 2 };
    const r = evaluateTrip(tripWith([changed]), j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === start.id)?.conflict?.reason).toBe('requirements_unmet');
    expect(r.stages[0]?.instructions[0]).toMatchObject({ revision: 2, acknowledged: false });
  });
});

describe('customer requirements', () => {
  // "Customer X at loading: no more than 2 tiers (acknowledge), straps checklist, photo of securing"
  const catalog = {
    ...BASE_CATALOG,
    requirementTemplates: {
      ...BASE_CATALOG.requirementTemplates,
      straps_photo: {
        code: 'straps_photo',
        title: { ru: 'Фото крепления ремнями' },
        kind: 'photo' as const,
        min: 2,
        beforePhase: 'departed' as const,
        strictness: 'block' as const,
        waivable: true,
      },
    },
    requirementRules: [...BASE_CATALOG.requirementRules, { template: 'straps_photo', stageTypes: ['loading'], customers: ['cust-x'] }],
    instructionRules: [
      ...BASE_CATALOG.instructionRules,
      {
        code: 'x_tiers',
        stageTypes: ['loading'],
        customers: ['cust-x'],
        instruction: { kind: 'text' as const, text: 'Не более 2 ярусов', showAt: 'arrived' as const, ackBeforePhase: 'started' as const },
      },
    ],
  };
  const stage = { id: 'load', typeCode: 'loading' };

  it('apply only to trips of that customer', () => {
    expect(materializeInstructions(stage, { customerId: 'cust-x' }, catalog).map((i) => [i.id, i.source])).toEqual([
      ['load:rule:x_tiers', 'customer'],
    ]);
    expect(materializeInstructions(stage, { customerId: 'cust-y' }, catalog)).toEqual([]);
    expect(materializeRequirements(stage, { customerId: 'cust-x' }, catalog).find((r) => r.template === 'straps_photo')?.source).toBe(
      'customer',
    );
    expect(materializeRequirements(stage, { customerId: 'cust-y' }, catalog).map((r) => r.template)).not.toContain('straps_photo');
  });
});
