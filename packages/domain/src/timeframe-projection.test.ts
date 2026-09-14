import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  createTimeframeProjection,
  validateProjectionParent,
  entityId,
  timestamp,
  type TimeframeProjection,
} from './index';

const start = timestamp('2026-09-10T00:07:12.345Z');
const end = timestamp('2026-09-11T03:16:22.765Z');
const insideStart = timestamp('2026-09-10T09:42:00.000Z');
const insideEnd = timestamp('2026-09-10T11:34:00.000Z');
const before = timestamp('2026-09-09T00:00:00.000Z');
const after = timestamp('2026-09-12T00:00:00.000Z');
const parentId = entityId('TimeframeProjection', 'projection-01');
const input: TimeframeProjection = {
  id: parentId,
  sourceEntityType: 'CANDLE',
  sourceEntityId: entityId('Candle', 'candle-01'),
  sourceTimeframeId: entityId('Timeframe', 'tf-01'),
  targetTimeframeId: entityId('Timeframe', 'tf-02'),
  intervalStart: start,
  intervalEnd: end,
  sourceHigh: null,
  sourceLow: null,
  colonyId: null,
  parentProjectionId: null,
  createdAt: after,
};
const parent = createTimeframeProjection(input);
const childInput: TimeframeProjection = {
  ...input,
  id: entityId('TimeframeProjection', 'projection-02'),
  parentProjectionId: parentId,
  intervalStart: insideStart,
  intervalEnd: insideEnd,
};

describe('supplied Timeframe Projections', () => {
  it('creates an immutable record without normalizing arbitrary intervals', () => {
    expect(parent).toEqual(input);
    expect(parent).not.toBe(input);
    expect(Object.isFrozen(parent)).toBe(true);
    expect(Object.keys(parent).sort()).toEqual(
      [
        'id',
        'sourceEntityType',
        'sourceEntityId',
        'sourceTimeframeId',
        'targetTimeframeId',
        'intervalStart',
        'intervalEnd',
        'sourceHigh',
        'sourceLow',
        'colonyId',
        'parentProjectionId',
        'createdAt',
      ].sort(),
    );
    expect(() => {
      (parent as { intervalStart: string }).intervalStart = before;
    }).toThrow(TypeError);
  });
  it.each([
    [null, null],
    [0, null],
    [null, -20],
    [0, 0],
    [-1, -10],
    [10, 0],
    [10, 10],
  ])(
    'accepts high %s and low %s without Forex-only assumptions',
    (sourceHigh, sourceLow) => {
      expect(
        createTimeframeProjection({ ...input, sourceHigh, sourceLow }),
      ).toMatchObject({ sourceHigh, sourceLow });
    },
  );
  it.each([
    ['high below low', { sourceHigh: -2, sourceLow: -1 }],
    ['nonfinite high', { sourceHigh: Infinity }],
    ['nonfinite low', { sourceLow: NaN }],
    ['non-numeric high', { sourceHigh: '10' }],
    ['missing low', { sourceLow: undefined }],
    ['equal interval', { intervalEnd: start }],
    ['reversed interval', { intervalEnd: before }],
    ['invalid start', { intervalStart: 'bad' }],
    ['invalid end', { intervalEnd: '2026-02-30T00:00:00.000Z' }],
    ['invalid creation', { createdAt: 'bad' }],
    ['self-parent', { parentProjectionId: parentId }],
    ['invalid own identity', { id: '' }],
    ['invalid source identity', { sourceEntityId: 'D candle #03' }],
    ['invalid source key', { sourceEntityType: ' ' }],
    ['invalid source timeframe', { sourceTimeframeId: '' }],
    ['invalid target timeframe', { targetTimeframeId: '' }],
    ['invalid colony', { colonyId: '' }],
    ['invalid parent identity', { parentProjectionId: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(() =>
      createTimeframeProjection({ ...input, ...patch } as TimeframeProjection),
    ).toThrow(DomainValidationError);
  });
  it('supports other source types and explicit Colony context', () => {
    const sourceEntityId = entityId('MarketObject', 'mo-01');
    const colonyId = entityId('Colony', 'col-01');
    expect(
      createTimeframeProjection({
        ...input,
        sourceEntityType: 'CUSTOM:OBJECT',
        sourceEntityId,
        colonyId,
      }),
    ).toMatchObject({ sourceEntityId, colonyId });
  });
  it('does not infer timeframe ordering, timeframe purposes or creation-versus-market chronology', () => {
    const tf = entityId('Timeframe', 'same-opaque-timeframe');
    const projection = createTimeframeProjection({
      ...input,
      sourceTimeframeId: tf,
      targetTimeframeId: tf,
      createdAt: before,
    });
    expect(projection.intervalStart).toBe(start);
    expect(projection.sourceTimeframeId).toBe(projection.targetTimeframeId);
    expect(projection).not.toHaveProperty('purpose');
    expect(projection).not.toHaveProperty('durationSeconds');
    expect(projection).not.toHaveProperty('currentState');
  });
  it.each([
    [insideStart, insideEnd],
    [start, insideEnd],
    [insideStart, end],
    [start, end],
  ])(
    'accepts contained child interval %s to %s, including shared edges',
    (intervalStart, intervalEnd) => {
      const child = createTimeframeProjection({
        ...childInput,
        intervalStart,
        intervalEnd,
      });
      expect(() => validateProjectionParent(child, parent)).not.toThrow();
      expect(() => validateProjectionParent(child, parent)).not.toThrow();
      expect(parent).toEqual(input);
    },
  );
  it.each([
    [before, insideEnd],
    [insideStart, after],
    [before, after],
  ])('rejects child outside parent: %s to %s', (intervalStart, intervalEnd) => {
    const child = createTimeframeProjection({
      ...childInput,
      intervalStart,
      intervalEnd,
    });
    expect(() => validateProjectionParent(child, parent)).toThrow(/outside/);
  });
  it.each([null, entityId('TimeframeProjection', 'other')])(
    'rejects missing/wrong parent reference %s',
    (parentProjectionId) => {
      const child = createTimeframeProjection({
        ...childInput,
        parentProjectionId,
      });
      expect(() => validateProjectionParent(child, parent)).toThrow(
        /identity mismatch/,
      );
    },
  );
  it('validates both supplied records before containment checks', () => {
    expect(() =>
      validateProjectionParent({ ...childInput, sourceLow: NaN }, parent),
    ).toThrow(DomainValidationError);
    expect(() =>
      validateProjectionParent(childInput, { ...parent, intervalEnd: start }),
    ).toThrow(DomainValidationError);
  });
  it('validates a supplied three-level drill-down without calculating candles', () => {
    const child = createTimeframeProjection(childInput);
    const grandchild = createTimeframeProjection({
      ...childInput,
      id: entityId('TimeframeProjection', 'projection-03'),
      parentProjectionId: child.id,
      sourceTimeframeId: child.targetTimeframeId,
      targetTimeframeId: entityId('Timeframe', 'tf-03'),
      intervalStart: timestamp('2026-09-10T10:00:00.000Z'),
      intervalEnd: timestamp('2026-09-10T10:05:00.000Z'),
    });
    expect(() => validateProjectionParent(child, parent)).not.toThrow();
    expect(() => validateProjectionParent(grandchild, child)).not.toThrow();
    expect(() => validateProjectionParent(grandchild, parent)).toThrow(
      /identity mismatch/,
    );
  });
});
