import { describe, expect, it } from 'vitest';
import { structureSyncConfigurationFromEnvironment } from './structure-sync';

describe('structure synchronization configuration', () => {
  it('uses a narrow H1 preview policy without freezing strategy semantics', () => {
    const config = structureSyncConfigurationFromEnvironment({});
    expect(config.timeframes).toEqual({
      H1: { MICRO: 8, INTERIOR: 20, EXTERIOR: 50 },
    });
    expect(config.equalityTolerancePips).toBe(0.5);
    expect(config.intervalMs).toBe(10_000);
  });

  it('accepts explicit per-timeframe reversal policies', () => {
    const config = structureSyncConfigurationFromEnvironment({
      ARISE_STRUCTURE_REVERSAL_PIPS_JSON: JSON.stringify({
        M5: { MICRO: 3, INTERIOR: 8, EXTERIOR: 20 },
        H1: { MICRO: 10, INTERIOR: 25, EXTERIOR: 60 },
      }),
      ARISE_STRUCTURE_EQUALITY_TOLERANCE_PIPS: '1.25',
      ARISE_STRUCTURE_SYNC_INTERVAL_MS: '2500',
    });
    expect(config.timeframes.M5).toEqual({ MICRO: 3, INTERIOR: 8, EXTERIOR: 20 });
    expect(config.timeframes.H1).toEqual({ MICRO: 10, INTERIOR: 25, EXTERIOR: 60 });
    expect(config.equalityTolerancePips).toBe(1.25);
    expect(config.intervalMs).toBe(2500);
  });

  it('rejects meaningless degree ordering', () => {
    expect(() => structureSyncConfigurationFromEnvironment({
      ARISE_STRUCTURE_REVERSAL_PIPS_JSON: JSON.stringify({
        H1: { MICRO: 20, INTERIOR: 8, EXTERIOR: 50 },
      }),
    })).toThrow(/MICRO < INTERIOR < EXTERIOR/);
  });
});
