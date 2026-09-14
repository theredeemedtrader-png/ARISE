import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  COLONY_RELATIONSHIPS,
  COLONY_STATES,
  COLONY_TRANSITIONS,
  DIRECTIONS,
  IDEA_STATUSES,
  IDEA_TRANSITIONS,
  TARGET_EVENT_TYPES,
  TARGET_MANAGEMENT_MODES,
  TARGET_STATUSES,
  TARGET_TRANSITIONS,
  DomainValidationError,
  InvalidTransitionError,
  canTransition,
  createColony,
  createColonyLineage,
  createColonyStateEvent,
  createIdea,
  createIdeaVersion,
  createInstrument,
  createSuccessorIdeaVersion,
  createTarget,
  createTargetEvent,
  createTimeframe,
  entityId,
  timestamp,
  transitionColony,
  transitionIdea,
  transitionTarget,
  validateColony,
  validateIdea,
  validateIdeaVersion,
  type ColonyId,
  type ColonyState,
  type Direction,
  type Idea,
  type IdeaId,
  type IdeaStatus,
  type IdeaVersionId,
  type Instrument,
  type InstrumentId,
  type MarketObjectId,
  type MarketObjectVersionId,
  type NewIdeaVersion,
  type TargetEventType,
  type TargetStatus,
  type Timeframe,
  type TimeframeId,
  type Timestamp,
  type TransitionContext,
} from './index';

const at = timestamp('2026-09-09T12:00:00.000Z');
const later = timestamp('2026-09-09T13:00:00.000Z');
const earlier = timestamp('2026-09-09T11:00:00.000Z');
const ideaInput = {
  id: entityId('Idea', 'i-01'),
  instrumentId: entityId('Instrument', 'ins-01'),
  thesisTimeframeId: entityId('Timeframe', 'tf-01'),
  createdAt: at,
};
const idea = createIdea(ideaInput);
const versionInput: NewIdeaVersion = {
  id: entityId('IdeaVersion', 'iv-01'),
  createdAt: at,
  direction: 'LONG',
  thesisText: 'Participate toward the weekly liquidity zone.',
  targetDescription: 'Next opposing external liquidity',
  invalidationDescription: 'Thesis structure fails',
  primaryTargetMarketObjectVersionId: entityId('MarketObjectVersion', 'mov-01'),
  invalidationMarketObjectVersionId: null,
};
const version = createIdeaVersion(idea, versionInput);
const colonyInput = {
  id: entityId('Colony', 'c-01'),
  idea,
  originalIdeaVersion: version,
  label: 'Weekly Long #05',
  createdAt: at,
};
const colony = createColony(colonyInput);
const targetInput = {
  id: entityId('Target', 't-01'),
  targetType: 'EXTERNAL_LIQUIDITY',
  exactPrice: 1.2,
  zoneMarketObjectId: entityId('MarketObject', 'mo-01'),
  managementMode: 'REFERENCE_ONLY' as const,
  createdAt: at,
};
const target = createTarget(colony, targetInput);
const context: TransitionContext = {
  occurredAt: later,
  reason: 'Explicit thesis review',
  sourceType: 'MANUAL_REVIEW',
  sourceId: 'review-01',
  manualOverride: true,
  correlationId: 'trace-01',
};
const colonyContext = { ...context, id: entityId('ColonyStateEvent', 'ce-01') };
const targetContext = { ...context, id: entityId('TargetEvent', 'te-01') };

// Independent expected edges, intentionally not derived from production transition tables.
const ideaEdges = [
  'DRAFT:WATCHING',
  'DRAFT:CANCELLED',
  'WATCHING:ACTIVE',
  'WATCHING:INVALIDATED',
  'WATCHING:CANCELLED',
  'ACTIVE:IN_PLAY',
  'ACTIVE:INVALIDATED',
  'ACTIVE:CANCELLED',
  'IN_PLAY:TARGET_APPROACHING',
  'IN_PLAY:INVALIDATED',
  'IN_PLAY:CANCELLED',
  'TARGET_APPROACHING:TARGET_HIT',
  'TARGET_APPROACHING:INVALIDATED',
  'TARGET_APPROACHING:CANCELLED',
  'TARGET_HIT:COMPLETED',
  'COMPLETED:ARCHIVED',
  'INVALIDATED:ARCHIVED',
  'CANCELLED:ARCHIVED',
];
const colonyEdges = [
  'DORMANT:BUILDING',
  'BUILDING:ESTABLISHED',
  'ESTABLISHED:MATURE',
  'BUILDING:DECAYING',
  'ESTABLISHED:DECAYING',
  'MATURE:DECAYING',
  'DORMANT:INVALIDATED',
  'BUILDING:INVALIDATED',
  'ESTABLISHED:INVALIDATED',
  'MATURE:INVALIDATED',
  'DECAYING:INVALIDATED',
  'BUILDING:COMPLETED',
  'ESTABLISHED:COMPLETED',
  'MATURE:COMPLETED',
  'INVALIDATED:COMPLETED',
];
const targetEdges = [
  'ACTIVE:APPROACHING',
  'APPROACHING:REACHED',
  'REACHED:HIT',
  'HIT:COMPLETED',
  'ACTIVE:INVALIDATED',
  'APPROACHING:INVALIDATED',
  'REACHED:INVALIDATED',
  'ACTIVE:REASSIGNED',
  'APPROACHING:REASSIGNED',
  'REACHED:REASSIGNED',
  'INVALIDATED:COMPLETED',
  'REASSIGNED:COMPLETED',
];

describe('opaque identities and immutable time', () => {
  it('preserves caller values through deterministic parsing and JSON', () => {
    for (const kind of [
      'Instrument',
      'Timeframe',
      'Idea',
      'IdeaVersion',
      'Colony',
      'ColonyLineage',
      'ColonyStateEvent',
      'Target',
      'TargetEvent',
      'MarketObject',
      'MarketObjectVersion',
    ] as const) {
      const id = entityId(kind, '3c7a:opaque_001-abc.def');
      expect(id).toBe('3c7a:opaque_001-abc.def');
      expect(entityId(kind, JSON.parse(JSON.stringify(id)))).toBe(id);
    }
  });
  it('keeps identity types distinct from labels and other entity references', () => {
    expectTypeOf<string>().not.toMatchTypeOf<IdeaId>();
    expectTypeOf<IdeaId>().not.toMatchTypeOf<ColonyId>();
    expectTypeOf<IdeaId>().not.toMatchTypeOf<IdeaVersionId>();
    expectTypeOf<InstrumentId>().not.toMatchTypeOf<TimeframeId>();
    expectTypeOf<MarketObjectId>().not.toMatchTypeOf<MarketObjectVersionId>();
    expect(colony.id).not.toBe(colony.label);
    expect(colony.instrumentId).not.toBe('EURUSD');
  });
  it.each([
    '',
    ' ',
    'Weekly Long #05',
    'Scout #24',
    'D FVG #03',
    ' id-1',
    'id-1 ',
    'a\nb',
  ])('rejects label/malformed token %j', (value) => {
    expect(() => entityId('Idea', value)).toThrow(DomainValidationError);
  });
  it.each([
    'invalid',
    '2026-02-30T00:00:00.000Z',
    '2026-09-09',
    '2026-09-09T12:00:00Z',
    '2026-09-09T25:00:00.000Z',
  ])('rejects invalid/noncanonical instant %s', (value) => {
    expect(() => timestamp(value)).toThrow(DomainValidationError);
  });
  it('timestamps are immutable primitives with deterministic round trip', () => {
    expect(typeof at).toBe('string');
    expect(timestamp(JSON.parse(JSON.stringify(at)))).toBe(at);
  });
});

describe('Instrument and Timeframe', () => {
  const instrument: Instrument = {
    id: idea.instrumentId,
    canonicalSymbol: 'EURUSD',
    displayName: 'Euro / US Dollar',
    assetClass: 'FOREX',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    tickSize: 0.00001,
    priceDigits: 5,
    enabled: true,
    createdAt: at,
  };
  it('preserves normalized market metadata independently of a broker', () => {
    const created = createInstrument(instrument);
    expect(created).toEqual(instrument);
    expect(Object.isFrozen(created)).toBe(true);
    expect(createInstrument({ ...instrument, enabled: false }).enabled).toBe(
      false,
    );
  });
  it.each([0, -1, NaN, Infinity])(
    'rejects invalid pip and tick size %s',
    (value) => {
      expect(() => createInstrument({ ...instrument, pipSize: value })).toThrow(
        DomainValidationError,
      );
      expect(() =>
        createInstrument({ ...instrument, tickSize: value }),
      ).toThrow(DomainValidationError);
    },
  );
  it.each([-1, 1.5, NaN, Infinity])(
    'rejects invalid price digits %s',
    (priceDigits) => {
      expect(() => createInstrument({ ...instrument, priceDigits })).toThrow(
        DomainValidationError,
      );
    },
  );
  it('validates all textual metadata, identity, enabled flag and created time', () => {
    for (const key of [
      'canonicalSymbol',
      'displayName',
      'assetClass',
      'baseCurrency',
      'quoteCurrency',
    ] as const) {
      expect(() => createInstrument({ ...instrument, [key]: ' ' })).toThrow(
        DomainValidationError,
      );
    }
    expect(() =>
      createInstrument({ ...instrument, id: '' as InstrumentId }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createInstrument({ ...instrument, enabled: 'yes' as unknown as boolean }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createInstrument({ ...instrument, createdAt: 'bad' as Timestamp }),
    ).toThrow(DomainValidationError);
  });
  it.each([
    ['1M', 60],
    ['5M', 300],
    ['1H', 3600],
    ['4H', 14400],
    ['8H', 28800],
  ] as const)(
    'supports fixed duration %s without H/A/E assignment',
    (code, durationSeconds) => {
      const tf = createTimeframe({
        id: idea.thesisTimeframeId,
        code,
        durationSeconds,
        calendarRule: null,
        displayOrder: 1,
      });
      expect(tf.durationSeconds).toBe(durationSeconds);
      expect(Object.keys(tf).sort()).toEqual([
        'calendarRule',
        'code',
        'displayOrder',
        'durationSeconds',
        'id',
      ]);
    },
  );
  it.each(['D', 'W', 'M'])(
    'requires and preserves a calendar rule for %s',
    (code) => {
      const tf: Timeframe = {
        id: idea.thesisTimeframeId,
        code,
        durationSeconds: null,
        calendarRule: 'session-rule-01',
        displayOrder: 4,
      };
      expect(createTimeframe(tf)).toEqual(tf);
      expect(() =>
        createTimeframe({ ...tf, calendarRule: null, durationSeconds: 86400 }),
      ).toThrow(DomainValidationError);
    },
  );
  it('rejects incomplete and invalid timeframe metadata', () => {
    const tf: Timeframe = {
      id: idea.thesisTimeframeId,
      code: 'custom',
      durationSeconds: 120,
      calendarRule: null,
      displayOrder: 0,
    };
    for (const durationSeconds of [null, 0, -1, 0.5, Infinity, NaN]) {
      expect(() => createTimeframe({ ...tf, durationSeconds })).toThrow(
        DomainValidationError,
      );
    }
    expect(() => createTimeframe({ ...tf, code: '' })).toThrow(
      DomainValidationError,
    );
    expect(() => createTimeframe({ ...tf, calendarRule: '' })).toThrow(
      DomainValidationError,
    );
    expect(() => createTimeframe({ ...tf, displayOrder: -1 })).toThrow(
      DomainValidationError,
    );
  });
});

describe('canonical Idea', () => {
  it('starts DRAFT with no archive or versioned prose/direction', () => {
    expect(idea).toEqual({
      ...ideaInput,
      currentStatus: 'DRAFT',
      archivedAt: null,
    });
    expect(idea).not.toHaveProperty('direction');
    expect(idea).not.toHaveProperty('thesisText');
    expect(Object.isFrozen(idea)).toBe(true);
  });
  it('progresses to completion then archives without changing prior values', () => {
    let current = idea;
    for (const status of [
      'WATCHING',
      'ACTIVE',
      'IN_PLAY',
      'TARGET_APPROACHING',
      'TARGET_HIT',
      'COMPLETED',
      'ARCHIVED',
    ] as const) {
      const previous = current;
      current = transitionIdea(previous, status, later);
      expect(current).not.toBe(previous);
      expect(current.archivedAt).toBe(status === 'ARCHIVED' ? later : null);
      expect(current.id).toBe(idea.id);
    }
    expect(idea.currentStatus).toBe('DRAFT');
    expect(idea.archivedAt).toBeNull();
    expect(() => transitionIdea(current, 'ACTIVE', later)).toThrow(
      InvalidTransitionError,
    );
  });
  it.each(IDEA_STATUSES)(
    'checks every outgoing edge and rejected shortcut from %s',
    (from) => {
      const current: Idea = {
        ...idea,
        currentStatus: from,
        archivedAt: from === 'ARCHIVED' ? at : null,
      };
      for (const to of IDEA_STATUSES) {
        const allowed = ideaEdges.includes(`${from}:${to}`);
        expect(canTransition(IDEA_TRANSITIONS, from, to)).toBe(allowed);
        if (allowed)
          expect(transitionIdea(current, to, later).currentStatus).toBe(to);
        else
          expect(() => transitionIdea(current, to, later)).toThrow(
            InvalidTransitionError,
          );
      }
    },
  );
  it('validates archive consistency, identity, chronology and unknown states', () => {
    expect(() => validateIdea({ ...idea, archivedAt: at })).toThrow(
      DomainValidationError,
    );
    expect(() => validateIdea({ ...idea, currentStatus: 'ARCHIVED' })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      validateIdea({ ...idea, currentStatus: 'ARCHIVED', archivedAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createIdea({ ...ideaInput, id: 'Weekly Long #05' as IdeaId }),
    ).toThrow(DomainValidationError);
    expect(() => transitionIdea(idea, 'WATCHING', earlier)).toThrow(
      DomainValidationError,
    );
    expect(() => transitionIdea(idea, 'BULL' as IdeaStatus, later)).toThrow(
      InvalidTransitionError,
    );
    expect(() =>
      transitionIdea(
        { ...idea, currentStatus: 'unknown' as IdeaStatus },
        'WATCHING',
        later,
      ),
    ).toThrow(DomainValidationError);
  });
  it('has no stop-out trigger or position-dependent invalidation', () => {
    expect(() =>
      transitionIdea(idea, 'STOPPED_OUT' as IdeaStatus, later),
    ).toThrow(InvalidTransitionError);
    expect(idea.currentStatus).toBe('DRAFT');
  });
});

describe('immutable IdeaVersion', () => {
  it.each(DIRECTIONS)('creates v1 with canonical direction %s', (direction) => {
    expect(
      createIdeaVersion(idea, { ...versionInput, direction }),
    ).toMatchObject({
      ideaId: idea.id,
      versionNo: 1,
      supersedesIdeaVersionId: null,
      direction,
    });
  });
  it.each(['BULL', 'BEAR', 'long', '', 'Not Reviewed'])(
    'rejects invalid direction %s',
    (direction) => {
      expect(() =>
        createIdeaVersion(idea, {
          ...versionInput,
          direction: direction as Direction,
        }),
      ).toThrow(DomainValidationError);
    },
  );
  it('creates deterministic successors with exact lineage and retained object versions', () => {
    const before = JSON.stringify(version);
    const input = {
      ...versionInput,
      id: entityId('IdeaVersion', 'iv-02'),
      createdAt: later,
      direction: 'SHORT' as const,
      thesisText: 'Revised thesis',
      primaryTargetMarketObjectVersionId: entityId(
        'MarketObjectVersion',
        'mov-02',
      ),
    };
    const next = createSuccessorIdeaVersion(version, input);
    expect(next.versionNo).toBe(2);
    expect(next.supersedesIdeaVersionId).toBe(version.id);
    expect(next.ideaId).toBe(idea.id);
    expect(next.primaryTargetMarketObjectVersionId).toBe('mov-02');
    expect(createSuccessorIdeaVersion(version, input)).toEqual(next);
    const third = createSuccessorIdeaVersion(next, {
      ...input,
      id: entityId('IdeaVersion', 'iv-03'),
    });
    expect(third.versionNo).toBe(3);
    expect(third.supersedesIdeaVersionId).toBe(next.id);
    expect(JSON.stringify(version)).toBe(before);
    expect(version.primaryTargetMarketObjectVersionId).toBe('mov-01');
    input.thesisText = 'caller edit';
    expect(next.thesisText).toBe('Revised thesis');
    expect(Object.isFrozen(next)).toBe(true);
    expect(() => Object.assign(next, { thesisText: 'overwrite' })).toThrow(
      TypeError,
    );
  });
  it('rejects reused immediate IDs, backward time, malformed history and version overflow', () => {
    expect(() => createSuccessorIdeaVersion(version, versionInput)).toThrow(
      DomainValidationError,
    );
    const input = { ...versionInput, id: entityId('IdeaVersion', 'iv-02') };
    expect(() =>
      createIdeaVersion(idea, { ...input, createdAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createSuccessorIdeaVersion(version, { ...input, createdAt: earlier }),
    ).toThrow(DomainValidationError);
    const second = createSuccessorIdeaVersion(version, input);
    expect(() => createSuccessorIdeaVersion(second, versionInput)).toThrow(
      DomainValidationError,
    );
    for (const invalid of [
      { versionNo: 0 },
      { versionNo: 1.5 },
      { versionNo: 2 },
      { supersedesIdeaVersionId: version.id },
      { thesisText: 4 },
      { primaryTargetMarketObjectVersionId: '' },
    ]) {
      expect(() =>
        validateIdeaVersion({ ...version, ...invalid } as typeof version),
      ).toThrow(DomainValidationError);
    }
    expect(() =>
      createSuccessorIdeaVersion(
        { ...second, versionNo: Number.MAX_SAFE_INTEGER },
        { ...input, id: entityId('IdeaVersion', 'iv-03') },
      ),
    ).toThrow(DomainValidationError);
  });
  it('allows draft prose and nullable Market Object version references', () => {
    const draft = createIdeaVersion(idea, {
      ...versionInput,
      thesisText: '',
      targetDescription: '',
      invalidationDescription: '',
      primaryTargetMarketObjectVersionId: null,
      invalidationMarketObjectVersionId: null,
    });
    expect(draft.thesisText).toBe('');
    expect(draft.primaryTargetMarketObjectVersionId).toBeNull();
  });
});

describe('Colony, lineage and immutable state history', () => {
  it('starts DORMANT and ties to the exact original thesis and instrument', () => {
    expect(colony).toMatchObject({
      currentState: 'DORMANT',
      ideaId: idea.id,
      originalIdeaVersionId: version.id,
      instrumentId: idea.instrumentId,
      currentTargetId: null,
      completedAt: null,
    });
    expect(colony.id).not.toBe(idea.id);
    expect(Object.isFrozen(colony)).toBe(true);
  });
  it('rejects cross-Idea versions and creation predating the thesis version', () => {
    expect(() =>
      createColony({
        ...colonyInput,
        originalIdeaVersion: { ...version, ideaId: entityId('Idea', 'i-02') },
      }),
    ).toThrow(DomainValidationError);
    expect(() => createColony({ ...colonyInput, createdAt: earlier })).toThrow(
      DomainValidationError,
    );
    expect(() => createColony({ ...colonyInput, label: ' ' })).toThrow(
      DomainValidationError,
    );
    expect(() => validateColony({ ...colony, completedAt: at })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      validateColony({ ...colony, currentState: 'COMPLETED' }),
    ).toThrow(DomainValidationError);
  });
  it('preserves origin through BUILDING → ESTABLISHED → MATURE with independent frozen events', () => {
    let current = colony;
    for (const [i, state] of (
      ['BUILDING', 'ESTABLISHED', 'MATURE'] as const
    ).entries()) {
      const previous = current;
      const result = transitionColony(previous, state, {
        ...colonyContext,
        id: entityId('ColonyStateEvent', `ce-${i}`),
      });
      current = result.colony;
      expect(result.event).toMatchObject({
        ...context,
        colonyId: colony.id,
        fromState: previous.currentState,
        toState: state,
      });
      expect(current.originalIdeaVersionId).toBe(version.id);
      expect(current.currentTargetId).toBeNull();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.event)).toBe(true);
      expect(() => Object.assign(result.event, { reason: 'rewrite' })).toThrow(
        TypeError,
      );
    }
    expect(colony.currentState).toBe('DORMANT');
  });
  it.each(COLONY_STATES)(
    'enforces every canonical edge and forbidden route from %s',
    (from) => {
      const current = {
        ...colony,
        currentState: from,
        completedAt: from === 'COMPLETED' ? at : null,
      };
      for (const to of COLONY_STATES) {
        const allowed = colonyEdges.includes(`${from}:${to}`);
        expect(canTransition(COLONY_TRANSITIONS, from, to)).toBe(allowed);
        if (allowed) {
          const result = transitionColony(current, to, colonyContext);
          expect(result.colony.currentState).toBe(to);
          expect(result.colony.completedAt).toBe(
            to === 'COMPLETED' ? later : null,
          );
          expect(result.event.fromState).toBe(from);
          expect(result.event.toState).toBe(to);
        } else
          expect(() => transitionColony(current, to, colonyContext)).toThrow(
            InvalidTransitionError,
          );
      }
    },
  );
  it('records decay, invalidation and intentional completion without changing the Idea', () => {
    let current = colony;
    for (const state of [
      'BUILDING',
      'DECAYING',
      'INVALIDATED',
      'COMPLETED',
    ] as const) {
      current = transitionColony(current, state, {
        ...colonyContext,
        id: entityId('ColonyStateEvent', `ce-${state}`),
      }).colony;
    }
    expect(current.completedAt).toBe(later);
    expect(idea.currentStatus).toBe('DRAFT');
    expect(current.originalIdeaVersionId).toBe(version.id);
  });
  it('does not allow manual override metadata to bypass validation', () => {
    expect(() => transitionColony(colony, 'MATURE', colonyContext)).toThrow(
      InvalidTransitionError,
    );
    expect(() =>
      transitionColony(colony, 'BUILDING', {
        ...colonyContext,
        occurredAt: earlier,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      transitionColony(colony, 'ALIEN' as ColonyState, colonyContext),
    ).toThrow(InvalidTransitionError);
  });
  it.each(COLONY_RELATIONSHIPS)(
    'records %s with distinct explicit endpoints and no source mutation',
    (relationshipType) => {
      const input = {
        id: entityId('ColonyLineage', 'cl-01'),
        sourceColonyId: colony.id,
        targetColonyId: entityId('Colony', 'c-02'),
        relationshipType,
      };
      const lineage = createColonyLineage(input);
      expect(lineage).toEqual(input);
      expect(Object.isFrozen(lineage)).toBe(true);
      expect(() =>
        createColonyLineage({ ...input, targetColonyId: colony.id }),
      ).toThrow(DomainValidationError);
      expect(colony.currentState).toBe('DORMANT');
    },
  );
  it('rejects unknown lineage relationships', () => {
    expect(() =>
      createColonyLineage({
        id: entityId('ColonyLineage', 'cl-01'),
        sourceColonyId: colony.id,
        targetColonyId: entityId('Colony', 'c-02'),
        relationshipType: 'MERGED' as 'PROMOTED_TO',
      }),
    ).toThrow(DomainValidationError);
  });
});

describe('semantic Target and immutable TargetEvent', () => {
  it.each(TARGET_MANAGEMENT_MODES)(
    'preserves %s independently of lifecycle without broker fields',
    (managementMode) => {
      let current = createTarget(colony, { ...targetInput, managementMode });
      expect(current.status).toBe('ACTIVE');
      const states: TargetStatus[] = [current.status];
      for (const to of [
        'APPROACHING',
        'REACHED',
        'HIT',
        'COMPLETED',
      ] as const) {
        const result = transitionTarget(current, to, {
          ...targetContext,
          id: entityId('TargetEvent', `te-${to}`),
        });
        expect(result.event.fromStatus).toBe(current.status);
        expect(result.event.toStatus).toBe(to);
        expect(result.event.eventType).toBe(to);
        expect(result.target.managementMode).toBe(managementMode);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.event)).toBe(true);
        current = result.target;
        states.push(current.status);
      }
      expect(states).toEqual([
        'ACTIVE',
        'APPROACHING',
        'REACHED',
        'HIT',
        'COMPLETED',
      ]);
      expect(Object.keys(current).sort()).toEqual([
        'colonyId',
        'createdAt',
        'exactPrice',
        'id',
        'managementMode',
        'status',
        'targetType',
        'zoneMarketObjectId',
      ]);
    },
  );
  it.each(TARGET_STATUSES)(
    'enforces every allowed/rejected Target route from %s',
    (from) => {
      const current = { ...target, status: from };
      for (const to of TARGET_STATUSES) {
        const allowed = targetEdges.includes(`${from}:${to}`);
        expect(canTransition(TARGET_TRANSITIONS, from, to)).toBe(allowed);
        if (allowed)
          expect(
            transitionTarget(current, to as TargetEventType, targetContext)
              .target.status,
          ).toBe(to);
        else
          expect(() =>
            transitionTarget(current, to as TargetEventType, targetContext),
          ).toThrow(DomainValidationError);
      }
    },
  );
  it('keeps REACHED separate from HIT, and does not advance Idea/Colony or change management', () => {
    const approaching = transitionTarget(
      target,
      'APPROACHING',
      targetContext,
    ).target;
    const reached = transitionTarget(approaching, 'REACHED', {
      ...targetContext,
      id: entityId('TargetEvent', 'te-02'),
    });
    expect(reached.target.status).toBe('REACHED');
    expect(reached.event.eventType).not.toBe('HIT');
    expect(colony.currentState).toBe('DORMANT');
    expect(idea.currentStatus).toBe('DRAFT');
    expect(target.status).toBe('ACTIVE');
    expect(target.managementMode).toBe('REFERENCE_ONLY');
  });
  it('allows semantic-only, price-only, zone-only and combined destinations', () => {
    for (const [exactPrice, zoneMarketObjectId] of [
      [null, null],
      [1.2, null],
      [null, target.zoneMarketObjectId],
      [1.2, target.zoneMarketObjectId],
    ] as const) {
      expect(
        createTarget(colony, {
          ...targetInput,
          exactPrice,
          zoneMarketObjectId,
        }),
      ).toMatchObject({ exactPrice, zoneMarketObjectId });
    }
    expect(
      createTarget(colony, { ...targetInput, exactPrice: -1 }).exactPrice,
    ).toBe(-1);
  });
  it('rejects malformed destination, mode, identity, timestamp and mismatched event semantics', () => {
    for (const exactPrice of [NaN, Infinity, -Infinity]) {
      expect(() =>
        createTarget(colony, { ...targetInput, exactPrice }),
      ).toThrow(DomainValidationError);
    }
    expect(() =>
      createTarget(colony, { ...targetInput, targetType: '' }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTarget(colony, {
        ...targetInput,
        managementMode: 'AUTO' as 'MANUAL',
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTarget(colony, { ...targetInput, createdAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTarget(colony, {
        ...targetInput,
        zoneMarketObjectId: '' as MarketObjectId,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      transitionTarget(target, 'APPROACHING', {
        ...targetContext,
        occurredAt: earlier,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTargetEvent({
        ...targetContext,
        targetId: target.id,
        fromStatus: 'ACTIVE',
        toStatus: 'APPROACHING',
        eventType: 'HIT',
      }),
    ).toThrow(DomainValidationError);
  });
  it('represents all required events with immutable exact references and metadata', () => {
    const sourceStates: Record<TargetEventType, TargetStatus> = {
      APPROACHING: 'ACTIVE',
      REACHED: 'APPROACHING',
      HIT: 'REACHED',
      INVALIDATED: 'ACTIVE',
      REASSIGNED: 'ACTIVE',
      COMPLETED: 'HIT',
    };
    for (const eventType of TARGET_EVENT_TYPES) {
      const event = createTargetEvent({
        ...targetContext,
        targetId: target.id,
        fromStatus: sourceStates[eventType],
        toStatus: eventType,
        eventType,
      });
      expect(event).toMatchObject({
        ...context,
        targetId: target.id,
        eventType,
      });
      expect(() => Object.assign(event, { occurredAt: earlier })).toThrow(
        TypeError,
      );
    }
  });
});

describe('audit metadata and pure transition boundaries', () => {
  it('supports absent source/correlation IDs without losing reason or source type', () => {
    const event = createColonyStateEvent({
      ...colonyContext,
      sourceId: null,
      correlationId: null,
      colonyId: colony.id,
      fromState: 'DORMANT',
      toState: 'BUILDING',
    });
    expect(event.sourceId).toBeNull();
    expect(event.correlationId).toBeNull();
    expect(event.reason).toBe(context.reason);
  });
  it('rejects malformed audit metadata in both event families', () => {
    for (const bad of [
      { reason: '' },
      { sourceType: ' ' },
      { sourceId: 'bad label' },
      { correlationId: '' },
      { occurredAt: 'bad' as Timestamp },
      { manualOverride: 'yes' as unknown as boolean },
    ]) {
      expect(() =>
        transitionColony(colony, 'BUILDING', { ...colonyContext, ...bad }),
      ).toThrow(DomainValidationError);
      expect(() =>
        transitionTarget(target, 'APPROACHING', { ...targetContext, ...bad }),
      ).toThrow(DomainValidationError);
    }
  });
  it('is deterministic, leaves inputs unchanged, and freezes public transition tables', () => {
    const before = JSON.stringify({ idea, version, colony, target, context });
    expect(transitionColony(colony, 'BUILDING', colonyContext)).toEqual(
      transitionColony(colony, 'BUILDING', colonyContext),
    );
    expect(transitionTarget(target, 'APPROACHING', targetContext)).toEqual(
      transitionTarget(target, 'APPROACHING', targetContext),
    );
    expect(transitionIdea(idea, 'WATCHING', later)).toEqual(
      transitionIdea(idea, 'WATCHING', later),
    );
    expect(JSON.stringify({ idea, version, colony, target, context })).toBe(
      before,
    );
    for (const table of [
      IDEA_TRANSITIONS,
      COLONY_TRANSITIONS,
      TARGET_TRANSITIONS,
    ]) {
      expect(Object.isFrozen(table)).toBe(true);
      for (const outgoing of Object.values(table))
        expect(Object.isFrozen(outgoing)).toBe(true);
    }
    expect(
      canTransition(IDEA_TRANSITIONS, 'toString' as IdeaStatus, 'DRAFT'),
    ).toBe(false);
  });
});
