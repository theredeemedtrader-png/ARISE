import { DomainValidationError } from './primitives';

export type MarketObjectJson =
  | null
  | boolean
  | string
  | number
  | readonly MarketObjectJson[]
  | { readonly [key: string]: MarketObjectJson };

/** Deterministic JSON only. Descriptors are inspected without invoking getters. */
export function copyMarketObjectJson(value: unknown): MarketObjectJson {
  const ancestors = new Set<object>();
  function copy(input: unknown): MarketObjectJson {
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean'
    )
      return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null)
      throw new DomainValidationError(
        'Market Object payload must contain finite JSON values only',
      );
    if (ancestors.has(input))
      throw new DomainValidationError(
        'Market Object JSON must not contain cycles',
      );
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new DomainValidationError(
        'Market Object JSON requires plain objects or arrays',
      );
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (typeof key !== 'string' || !('value' in descriptors[key]!))
        throw new DomainValidationError(
          'Market Object JSON rejects accessors and symbol keys',
        );
      if (!(array && key === 'length') && !descriptors[key]!.enumerable)
        throw new DomainValidationError(
          'Market Object JSON properties must be enumerable',
        );
    }
    ancestors.add(input);
    let result: MarketObjectJson;
    if (array) {
      const length = (input as unknown[]).length;
      if (keys.length !== length + 1)
        throw new DomainValidationError(
          'Market Object arrays must be dense without extra properties',
        );
      const entries: MarketObjectJson[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor)
          throw new DomainValidationError('Market Object arrays must be dense');
        entries.push(copy(descriptor.value));
      }
      result = Object.freeze(entries);
    } else {
      result = Object.freeze(
        Object.fromEntries(
          Object.entries(descriptors).map(([key, descriptor]) => [
            key,
            copy(descriptor.value),
          ]),
        ),
      );
    }
    ancestors.delete(input);
    return result;
  }
  return copy(value);
}
