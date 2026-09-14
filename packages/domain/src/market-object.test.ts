import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DomainValidationError,
  MARKET_OBJECT_GEOMETRY_TYPES,
  MARKET_OBJECT_ROLES,
  MARKET_OBJECT_SEMANTIC_TYPES,
  copyMarketObjectJson,
  createMarketObject,
  createMarketObjectWithInitialVersion,
  createMarketObjectVersion,
  reviseMarketObject,
  createMarketObjectRelation,
  createMarketObjectReference,
  resolveMarketObjectReference,
  entityId,
  timestamp,
  type CandleId,
  type MarketObjectRelationId,
  type TimeframeProjectionId,
  type MarketObjectId,
  type MarketObjectVersionId,
  type NewMarketObject,
  type MarketObjectRevision,
  type MarketObjectReference,
  type MarketObjectVersion,
} from './index';

const at = timestamp('2026-09-10T12:00:00.000Z');
const later = timestamp('2026-09-10T13:00:00.000Z');
const earlier = timestamp('2026-09-10T11:00:00.000Z');
const mo = entityId('MarketObject', 'mo-01');
const v1id = entityId('MarketObjectVersion', 'mov-01');
const v2id = entityId('MarketObjectVersion', 'mov-02');
const base: NewMarketObject = {
  id: mo,
  instrumentId: entityId('Instrument', 'ins-01'),
  ownerType: 'COLONY',
  ownerId: entityId('Colony', 'col-01'),
  geometryType: 'RECTANGLE',
  semanticType: 'GENERIC_ZONE',
  role: 'REFERENCE',
  timeframeId: null,
  name: 'D FVG #03',
  versionId: v1id,
  createdAt: at,
  archivedAt: null,
  geometryJson: { prices: [1.1, 1.2], anchors: [{ time: at }] },
  semanticPropertiesJson: { source: { confirmed: false }, tags: ['manual'] },
  sourceCandleIds: [entityId('Candle', 'candle-01')],
};
function initial(overrides: Partial<NewMarketObject> = {}) {
  return createMarketObjectWithInitialVersion({ ...base, ...overrides });
}
function revised(changes: Partial<MarketObjectRevision> = {}) {
  const first = initial();
  return reviseMarketObject(first.marketObject, first.version, {
    id: v2id,
    createdAt: later,
    ...changes,
  });
}

describe('M1.3 opaque identities', () => {
  it.each(['MarketObjectRelation', 'TimeframeProjection', 'Candle'] as const)(
    'preserves caller-supplied %s tokens',
    (kind) => {
      expect(entityId(kind, 'external:abc-01')).toBe('external:abc-01');
      for (const label of ['', 'D FVG #03', 'bar index 24', 'a b'])
        expect(() => entityId(kind, label)).toThrow(DomainValidationError);
    },
  );
  it('keeps identities distinct at the TypeScript boundary', () => {
    expectTypeOf<CandleId>().not.toEqualTypeOf<MarketObjectId>();
    expectTypeOf<MarketObjectRelationId>().not.toEqualTypeOf<TimeframeProjectionId>();
    expectTypeOf<MarketObjectId>().not.toEqualTypeOf<MarketObjectVersionId>();
    expectTypeOf<string>().not.toMatchTypeOf<CandleId>();
    const candle = entityId('Candle', 'c-01');
    // @ts-expect-error A Candle is not a projection.
    const projection: TimeframeProjectionId = candle;
    // @ts-expect-error Labels cannot stand in for typed relations.
    const relation: MarketObjectRelationId = 'D FVG #03';
    // @ts-expect-error Market Object IDs are not version IDs.
    const version: MarketObjectVersionId = mo;
    expect([projection, relation, version]).toHaveLength(3);
  });
});

describe('Market Object shape and meaning', () => {
  it('exports the exact closed shape/role vocabularies and built-in examples', () => {
    expect(MARKET_OBJECT_GEOMETRY_TYPES).toEqual([
      'LINE',
      'RAY',
      'RECTANGLE',
      'TRENDLINE',
      'POINT',
      'CANDLE_REFERENCE',
      'TEXT',
    ]);
    expect(MARKET_OBJECT_ROLES).toEqual([
      'REFERENCE',
      'AREA',
      'TRIGGER',
      'TARGET',
      'INVALIDATION',
      'PROTECTION',
      'CONFIRMATION',
      'ORIGIN',
    ]);
    expect(MARKET_OBJECT_SEMANTIC_TYPES).toEqual([
      'GENERIC_ZONE',
      'FVG',
      'ORDER_BLOCK',
      'LIQUIDITY_ZONE',
      'RANGE',
      'PREMIUM_DISCOUNT',
      'TARGET_ZONE',
      'INVALIDATION_ZONE',
      'CUSTOM',
    ]);
    for (const vocabulary of [
      MARKET_OBJECT_GEOMETRY_TYPES,
      MARKET_OBJECT_ROLES,
      MARKET_OBJECT_SEMANTIC_TYPES,
    ])
      expect(Object.isFrozen(vocabulary)).toBe(true);
  });
  it.each(MARKET_OBJECT_GEOMETRY_TYPES)(
    'supports %s without semantic inference',
    (geometryType) => {
      const { marketObject, version } = initial({ geometryType });
      expect(marketObject.geometryType).toBe(geometryType);
      expect(version.geometryType).toBe(geometryType);
      expect(version.semanticType).toBe('GENERIC_ZONE');
      expect(version.role).toBe('REFERENCE');
    },
  );
  it.each(MARKET_OBJECT_ROLES)('supports FVG role %s independently', (role) => {
    const { marketObject, version } = initial({ semanticType: 'FVG', role });
    expect(marketObject.role).toBe(role);
    expect(version.role).toBe(role);
    expect(version.semanticType).toBe('FVG');
  });
  it.each([...MARKET_OBJECT_SEMANTIC_TYPES, 'user:my_semantics/v2'])(
    'accepts rectangle semantics %s',
    (semanticType) => {
      const { marketObject, version } = initial({ semanticType });
      expect(marketObject.geometryType).toBe('RECTANGLE');
      expect(version.semanticType).toBe(semanticType);
      expect(version.role).toBe('REFERENCE');
    },
  );
  it('allows other owner contexts and an opaque, non-label identity', () => {
    const { marketObject } = initial({
      ownerType: 'RESEARCH_CONTEXT',
      ownerId: entityId('Idea', 'idea-17'),
    });
    expect(marketObject.ownerType).toBe('RESEARCH_CONTEXT');
    expect(marketObject.ownerId).toBe('idea-17');
    expect(marketObject.name).toBe('D FVG #03');
    expect(marketObject.id).toBe(mo);
  });
  it('preserves nullable timeframe and accepts explicit timeframe metadata', () => {
    expect(initial().version.timeframeId).toBeNull();
    const id = entityId('Timeframe', 'tf-opaque');
    expect(initial({ timeframeId: id }).version.timeframeId).toBe(id);
  });
  it('preserves archive data without deleting versions or adding lifecycle fields', () => {
    const { marketObject, version } = initial({
      archivedAt: later,
      role: 'AREA',
    });
    expect(marketObject.archivedAt).toBe(later);
    expect(version.id).toBe(v1id);
    expect(Object.keys(marketObject).sort()).toEqual(
      [
        'id',
        'instrumentId',
        'ownerType',
        'ownerId',
        'geometryType',
        'semanticType',
        'role',
        'timeframeId',
        'name',
        'currentVersionId',
        'createdAt',
        'archivedAt',
      ].sort(),
    );
    expect(Object.keys(version).sort()).toEqual(
      [
        'id',
        'marketObjectId',
        'versionNo',
        'geometryType',
        'semanticType',
        'role',
        'timeframeId',
        'name',
        'geometryJson',
        'semanticPropertiesJson',
        'sourceCandleIds',
        'createdAt',
        'supersedesVersionId',
      ].sort(),
    );
    expect(Object.isFrozen(marketObject)).toBe(true);
  });
  it.each([
    ['id', 'display label'],
    ['instrumentId', ''],
    ['ownerType', ' '],
    ['ownerId', 'Weekly Long #05'],
    ['geometryType', 'BOX'],
    ['semanticType', ''],
    ['role', 'ARMED'],
    ['timeframeId', ' '],
    ['name', '\t'],
    ['versionId', ''],
    ['createdAt', '2026-02-30'],
    ['archivedAt', earlier],
  ])('rejects invalid %s', (key, value) => {
    expect(() => initial({ [key]: value } as Partial<NewMarketObject>)).toThrow(
      DomainValidationError,
    );
  });
  it('hydrates a current snapshot with explicit validation and strips unrelated fields', () => {
    const object = initial().marketObject;
    expect(
      createMarketObject({
        ...object,
        chartHandle: 'not canonical',
      } as typeof object),
    ).toEqual(object);
    expect(() =>
      createMarketObject({
        ...object,
        currentVersionId: '' as MarketObjectVersionId,
      }),
    ).toThrow(DomainValidationError);
  });
});

describe('Market Object JSON and source identities', () => {
  it('copies and deeply freezes payloads and source candle references', () => {
    const geometry = { points: [{ price: 0 }] };
    const semantics = { nested: { labels: ['a'] } };
    const candles = [entityId('Candle', 'c-01')];
    const result = initial({
      geometryJson: geometry,
      semanticPropertiesJson: semantics,
      sourceCandleIds: candles,
    });
    geometry.points[0]!.price = 99;
    semantics.nested.labels.push('b');
    candles.push(entityId('Candle', 'c-02'));
    expect(result.version.geometryJson).toEqual({ points: [{ price: 0 }] });
    expect(result.version.semanticPropertiesJson).toEqual({
      nested: { labels: ['a'] },
    });
    expect(result.version.sourceCandleIds).toEqual(['c-01']);
    const geom = result.version.geometryJson as typeof geometry;
    const sem = result.version.semanticPropertiesJson as typeof semantics;
    for (const frozen of [
      result,
      result.version,
      geom,
      geom.points,
      geom.points[0],
      sem,
      sem.nested,
      sem.nested.labels,
      result.version.sourceCandleIds,
    ])
      expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      geom.points[0]!.price = 7;
    }).toThrow(TypeError);
    expect(() => {
      sem.nested.labels.push('c');
    }).toThrow(TypeError);
    expect(Object.isFrozen(geometry)).toBe(false);
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const extraArray = Object.assign([1], { extra: 2 });
  const hiddenArray = Object.defineProperty([1], 'extra', { value: 2 });
  const symbolArray = Object.assign([1], { [Symbol('x')]: 2 });
  const sparse = new Array(2);
  sparse[1] = 1;
  const disguisedSparse = Object.assign(new Array(1), { x: 1 });
  class Coordinates {
    x = 1;
  }
  const invalidJson: [string, unknown][] = [
    ['function', () => 1],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative Infinity', -Infinity],
    ['bigint', 1n],
    ['symbol value', Symbol('x')],
    ['cycle', cycle],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['class', new Coordinates()],
    ['typed array', new Uint8Array([1])],
    ['nested undefined', { x: undefined }],
    ['nested function', { x: () => 1 }],
    ['symbol key', { [Symbol('x')]: 1 }],
    [
      'accessor',
      {
        get x() {
          throw new Error('getter must not run');
        },
      },
    ],
    ['hidden property', Object.defineProperty({}, 'x', { value: 1 })],
    ['sparse array', sparse],
    ['disguised sparse array', disguisedSparse],
    ['extra array property', extraArray],
    ['hidden array property', hiddenArray],
    ['symbol array property', symbolArray],
    [
      'array accessor',
      Object.defineProperty([1], '0', {
        get() {
          throw new Error('getter must not run');
        },
        enumerable: true,
      }),
    ],
  ];
  it.each(invalidJson)('rejects %s in either payload', (_label, payload) => {
    for (const key of ['geometryJson', 'semanticPropertiesJson'])
      expect(() =>
        initial({ [key]: payload } as Partial<NewMarketObject>),
      ).toThrow(DomainValidationError);
  });
  it.each([null, false, true, '', 0, -2, [], {}])(
    'accepts JSON value %j without inventing geometry schema',
    (value) => {
      expect(copyMarketObjectJson(value)).toEqual(value);
    },
  );
  it('allows repeated acyclic values and preserves special JSON keys safely', () => {
    const shared = { v: 2 };
    expect(copyMarketObjectJson({ a: shared, b: shared })).toEqual({
      a: { v: 2 },
      b: { v: 2 },
    });
    const special = JSON.parse(
      '{"__proto__":{"x":1},"constructor":"data"}',
    ) as unknown;
    const copy = copyMarketObjectJson(special);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(special));
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(
      copyMarketObjectJson(Object.assign(Object.create(null), { a: 1 })),
    ).toEqual({ a: 1 });
  });
  it.each([null, [24], ['bar index 24'], [''], [undefined], new Array(1)])(
    'rejects invalid Candle reference collection %j',
    (value) => {
      expect(() =>
        initial({ sourceCandleIds: value as readonly CandleId[] }),
      ).toThrow(DomainValidationError);
    },
  );
  it('allows no source candles and does not perform candle lookup or deduplication', () => {
    expect(initial({ sourceCandleIds: [] }).version.sourceCandleIds).toEqual(
      [],
    );
    const id = entityId('Candle', 'opaque-provider-token');
    expect(
      initial({ sourceCandleIds: [id, id] }).version.sourceCandleIds,
    ).toEqual([id, id]);
  });
});

describe('Market Object historical integrity', () => {
  it('constructs initial version with an aligned pointer', () => {
    const pair = initial();
    expect(pair.version).toMatchObject({
      id: v1id,
      marketObjectId: mo,
      versionNo: 1,
      supersedesVersionId: null,
    });
    expect(pair.marketObject.currentVersionId).toBe(pair.version.id);
  });
  it('produces exact successor linkage and keeps all old snapshots unchanged', () => {
    const first = initial();
    const before = JSON.stringify(first);
    const second = reviseMarketObject(first.marketObject, first.version, {
      id: v2id,
      createdAt: later,
      geometryType: 'RAY',
      semanticType: 'FVG',
      role: 'AREA',
      name: 'Revised meaning',
      timeframeId: entityId('Timeframe', 'tf-02'),
      geometryJson: { price: -1 },
      semanticPropertiesJson: { confirmed: true },
      sourceCandleIds: [],
    });
    expect(second.marketObject).toMatchObject({
      id: mo,
      instrumentId: base.instrumentId,
      ownerId: base.ownerId,
      ownerType: base.ownerType,
      createdAt: at,
      currentVersionId: v2id,
    });
    expect(second.version).toMatchObject({
      id: v2id,
      versionNo: 2,
      supersedesVersionId: v1id,
      marketObjectId: mo,
      createdAt: later,
    });
    for (const key of [
      'geometryType',
      'semanticType',
      'role',
      'name',
      'timeframeId',
    ] as const)
      expect(second.marketObject[key]).toBe(second.version[key]);
    expect(JSON.stringify(first)).toBe(before);
    expect(first.version).toMatchObject({
      geometryType: 'RECTANGLE',
      semanticType: 'GENERIC_ZONE',
      role: 'REFERENCE',
      timeframeId: null,
      name: 'D FVG #03',
    });
    const third = reviseMarketObject(second.marketObject, second.version, {
      id: entityId('MarketObjectVersion', 'mov-03'),
      createdAt: later,
    });
    expect(third.version.versionNo).toBe(3);
    expect(third.version.supersedesVersionId).toBe(v2id);
  });
  it.each([
    ['geometryJson', { prices: [0, 1] }],
    ['semanticPropertiesJson', { confirmed: true }],
    ['geometryType', 'LINE'],
    ['role', 'AREA'],
    ['semanticType', 'user:custom'],
    ['timeframeId', entityId('Timeframe', 'tf-03')],
    ['name', 'New name'],
    ['sourceCandleIds', [entityId('Candle', 'c-02')]],
  ])('creates a version for a %s-only revision', (key, value) => {
    const pair = revised({ [key]: value });
    expect(pair.version).toMatchObject({
      id: v2id,
      versionNo: 2,
      supersedesVersionId: v1id,
      [key]: value,
    });
  });
  it('allows explicitly clearing nullable timeframe and keeps archive data', () => {
    const first = initial({
      timeframeId: entityId('Timeframe', 'tf-01'),
      archivedAt: later,
    });
    const next = reviseMarketObject(first.marketObject, first.version, {
      id: v2id,
      createdAt: later,
      timeframeId: null,
    });
    expect(next.version.timeframeId).toBeNull();
    expect(next.marketObject.archivedAt).toBe(later);
  });
  it.each([
    ['marketObjectId', entityId('MarketObject', 'other')],
    ['instrumentId', entityId('Instrument', 'other')],
    ['ownerId', entityId('Idea', 'other')],
    ['ownerType', 'OTHER'],
    ['currentVersionId', v2id],
    ['archivedAt', later],
    ['versionNo', 3],
    ['versionNo', 1],
    ['supersedesVersionId', v2id],
  ])('rejects revision attempts to supply %s = %s', (key, value) => {
    expect(() =>
      revised({ [key]: value } as Partial<MarketObjectRevision>),
    ).toThrow(DomainValidationError);
  });
  it('rejects stale supplied version, foreign owner, and inconsistent current semantics', () => {
    const first = initial();
    const second = revised();
    expect(() =>
      reviseMarketObject(second.marketObject, first.version, {
        id: entityId('MarketObjectVersion', 'v3'),
        createdAt: later,
      }),
    ).toThrow(/current version/);
    expect(() =>
      reviseMarketObject(
        first.marketObject,
        { ...first.version, marketObjectId: entityId('MarketObject', 'other') },
        { id: v2id, createdAt: later },
      ),
    ).toThrow(/ownership/);
    expect(() =>
      reviseMarketObject(
        { ...first.marketObject, role: 'AREA' },
        first.version,
        { id: v2id, createdAt: later },
      ),
    ).toThrow(/snapshot/);
  });
  it('rejects reused IDs and backward timestamps', () => {
    expect(() => revised({ id: v1id })).toThrow(/fresh/);
    expect(() => revised({ createdAt: earlier })).toThrow(
      DomainValidationError,
    );
    const second = revised();
    expect(() =>
      reviseMarketObject(second.marketObject, second.version, {
        id: v1id,
        createdAt: later,
      }),
    ).toThrow(/fresh/);
  });
  it('rejects version overflow', () => {
    const first = initial();
    const prior = createMarketObjectVersion({
      ...first.version,
      versionNo: Number.MAX_SAFE_INTEGER,
      supersedesVersionId: entityId('MarketObjectVersion', 'older'),
    });
    expect(() =>
      reviseMarketObject(first.marketObject, prior, {
        id: v2id,
        createdAt: later,
      }),
    ).toThrow(DomainValidationError);
  });
  it.each([
    { versionNo: 0 },
    { versionNo: 1.5 },
    { versionNo: 2 },
    { supersedesVersionId: v2id },
    { versionNo: 2, supersedesVersionId: v1id },
    { id: '' },
    { marketObjectId: '' },
    { createdAt: 'bad' },
  ])('rejects malformed hydrated version %j', (patch) => {
    expect(() =>
      createMarketObjectVersion({
        ...initial().version,
        ...patch,
      } as MarketObjectVersion),
    ).toThrow(DomainValidationError);
  });
  it('rejects revision accessors, symbols and explicit undefined', () => {
    expect(() =>
      revised({ name: undefined } as unknown as MarketObjectRevision),
    ).toThrow(DomainValidationError);
    const first = initial();
    const input = {
      id: v2id,
      createdAt: later,
      get name(): string {
        throw new Error('must not execute');
      },
    };
    expect(() =>
      reviseMarketObject(first.marketObject, first.version, input),
    ).toThrow(DomainValidationError);
    expect(() =>
      revised({ [Symbol('hidden')]: 1 } as Partial<MarketObjectRevision>),
    ).toThrow(DomainValidationError);
  });
});

describe('Market Object relations and references', () => {
  const relation = {
    id: entityId('MarketObjectRelation', 'rel-01'),
    sourceMarketObjectId: mo,
    targetMarketObjectId: entityId('MarketObject', 'mo-02'),
    relationType: 'CUSTOM:DERIVED_FROM',
    createdAt: at,
  };
  it('creates an immutable directed relation with an open semantic key', () => {
    const copy = createMarketObjectRelation(relation);
    expect(copy).toEqual(relation);
    expect(copy).not.toBe(relation);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.keys(copy)).toHaveLength(5);
  });
  it.each([
    'id',
    'sourceMarketObjectId',
    'targetMarketObjectId',
    'relationType',
    'createdAt',
  ])('rejects invalid relation %s', (key) => {
    expect(() =>
      createMarketObjectRelation({ ...relation, [key]: '' }),
    ).toThrow(DomainValidationError);
  });
  it('does not invent self-relation prohibitions or graph behavior', () => {
    expect(
      createMarketObjectRelation({ ...relation, targetMarketObjectId: mo })
        .targetMarketObjectId,
    ).toBe(mo);
  });
  const frozen = createMarketObjectReference({
    mode: 'FROZEN',
    marketObjectId: mo,
    versionId: v1id,
  });
  const live = createMarketObjectReference({
    mode: 'LIVE_LINKED',
    marketObjectId: mo,
  });
  it('keeps frozen v1 pinned and follows live v2 deterministically', () => {
    const first = initial();
    const second = revised({ semanticType: 'FVG', role: 'AREA' });
    for (const ref of [frozen, live])
      expect(
        resolveMarketObjectReference(ref, first.marketObject, [first.version]),
      ).toEqual(first.version);
    const supplied = [second.version, first.version];
    const before = JSON.stringify(supplied);
    for (let i = 0; i < 2; i++) {
      expect(
        resolveMarketObjectReference(frozen, second.marketObject, supplied),
      ).toEqual(first.version);
      expect(
        resolveMarketObjectReference(live, second.marketObject, supplied),
      ).toEqual(second.version);
    }
    expect(JSON.stringify(supplied)).toBe(before);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(live)).toBe(true);
  });
  it('frozen historical resolution does not require the current version to be supplied', () => {
    expect(
      resolveMarketObjectReference(frozen, revised().marketObject, [
        initial().version,
      ]).id,
    ).toBe(v1id);
  });
  it('resolves archived historical data without deleting or retargeting references', () => {
    const first = initial({ archivedAt: later });
    expect(
      resolveMarketObjectReference(frozen, first.marketObject, [first.version])
        .id,
    ).toBe(v1id);
  });
  it.each([frozen, live])(
    'rejects wrong object identity for $mode',
    (reference) => {
      const first = initial();
      expect(() =>
        resolveMarketObjectReference(
          { ...reference, marketObjectId: entityId('MarketObject', 'other') },
          first.marketObject,
          [first.version],
        ),
      ).toThrow(/identity mismatch/);
    },
  );
  it.each([frozen, live])(
    'rejects wrong version ownership for $mode',
    (reference) => {
      const first = initial();
      expect(() =>
        resolveMarketObjectReference(reference, first.marketObject, [
          {
            ...first.version,
            marketObjectId: entityId('MarketObject', 'other'),
          },
        ]),
      ).toThrow(/ownership mismatch/);
    },
  );
  it('fails missing exact versions without substituting available history', () => {
    const second = revised();
    expect(() =>
      resolveMarketObjectReference(frozen, second.marketObject, [
        second.version,
      ]),
    ).toThrow(/not supplied/);
    expect(() =>
      resolveMarketObjectReference(live, second.marketObject, [
        initial().version,
      ]),
    ).toThrow(/not supplied/);
    expect(() =>
      resolveMarketObjectReference(live, second.marketObject, []),
    ).toThrow(/not supplied/);
  });
  it('rejects ambiguous duplicate requested IDs instead of depending on array ordering', () => {
    const first = initial();
    expect(() =>
      resolveMarketObjectReference(live, first.marketObject, [
        first.version,
        first.version,
      ]),
    ).toThrow(/duplicate/);
  });
  it('rejects current semantic mismatch and version predating object creation', () => {
    const first = initial();
    expect(() =>
      resolveMarketObjectReference(
        live,
        { ...first.marketObject, name: 'Unversioned edit' },
        [first.version],
      ),
    ).toThrow(/snapshot/);
    expect(() =>
      resolveMarketObjectReference(frozen, first.marketObject, [
        { ...first.version, createdAt: earlier },
      ]),
    ).toThrow(DomainValidationError);
  });
  it.each([
    { mode: 'AUTO', marketObjectId: mo },
    { mode: 'FROZEN', marketObjectId: mo },
    { mode: 'FROZEN', marketObjectId: mo, versionId: '' },
    { mode: 'LIVE_LINKED', marketObjectId: mo, versionId: null },
    { mode: 'LIVE_LINKED', marketObjectId: '' },
  ])('rejects invalid or ambiguous reference %j', (input) => {
    expect(() =>
      createMarketObjectReference(input as MarketObjectReference),
    ).toThrow(DomainValidationError);
  });
});
