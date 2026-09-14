import { DomainValidationError, requireText } from './primitives';

declare const brokerKeyBrand: unique symbol;
/** Provider-owned opaque string. Never parse it as an MT5 ticket or derive it from a label. */
export type BrokerPositionKey = string & { readonly [brokerKeyBrand]: true };
export function brokerPositionKey(value: string): BrokerPositionKey {
  requireText(value, 'brokerPositionKey');
  return value as BrokerPositionKey;
}
export function requireFinite(value: number, field: string): void {
  if (!Number.isFinite(value))
    throw new DomainValidationError(`${field} must be finite`);
}
export function requireNonnegative(value: number, field: string): void {
  requireFinite(value, field);
  if (value < 0)
    throw new DomainValidationError(`${field} must be nonnegative`);
}
export function requireBoolean(value: boolean, field: string): void {
  if (typeof value !== 'boolean')
    throw new DomainValidationError(`${field} must be boolean`);
}
export type RuleValue =
  | string
  | number
  | boolean
  | null
  | readonly RuleValue[]
  | { readonly [key: string]: RuleValue };
/** Copy/freeze opaque JSON metadata, without interpreting cooldown/reset/strategy semantics. */
export function copyRuleValue(value: RuleValue): RuleValue {
  const ancestors = new Set<object>();
  function copy(input: RuleValue): RuleValue {
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean'
    )
      return input;
    if (typeof input === 'number') {
      requireFinite(input, 'rule number');
      return input;
    }
    if (typeof input !== 'object')
      throw new DomainValidationError('Rules must contain JSON values only');
    if (ancestors.has(input))
      throw new DomainValidationError('Rule must not contain cycles');
    if (
      !Array.isArray(input) &&
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) {
      throw new DomainValidationError(
        'Rule objects must be plain JSON objects',
      );
    }
    ancestors.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || !('value' in descriptors[key]!))
        throw new DomainValidationError('Rule accessors/symbols are not JSON');
    }
    let result: RuleValue;
    if (Array.isArray(input)) {
      if (Object.keys(input).length !== input.length)
        throw new DomainValidationError(
          'Rule arrays must be dense without extra properties',
        );
      result = Object.freeze(
        Array.from({ length: input.length }, (_, i) => {
          if (!Object.hasOwn(input, i))
            throw new DomainValidationError('Rule arrays must be dense');
          return copy(descriptors[String(i)]!.value as RuleValue);
        }),
      );
    } else {
      const entries = Object.keys(descriptors).map((key) => {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable)
          throw new DomainValidationError('Rule properties must be enumerable');
        return [key, copy(descriptor.value as RuleValue)] as const;
      });
      result = Object.freeze(Object.fromEntries(entries));
    }
    ancestors.delete(input);
    return result;
  }
  return copy(value);
}
export interface EligibilityDecision<R extends string> {
  readonly allowed: boolean;
  readonly reasons: readonly R[];
}
export function eligibilityDecision<R extends string>(
  reasons: readonly R[],
): EligibilityDecision<R> {
  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze([...reasons]),
  });
}
