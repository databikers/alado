type ValidatorFn = (input: any, root?: any) => boolean | Promise<boolean>;
type SyncValidatorFn = (input: any, root?: any) => boolean;

const ASYNC_RULE_ERROR = 'Validator contains async rules — use .build() instead of .buildSync()';

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any).then === 'function';
}

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction';
}

// Stays synchronous when every result is synchronous, so composed
// validators built with .buildSync() can be nested in shape() / items().
function every(results: Array<boolean | Promise<boolean>>): boolean | Promise<boolean> {
  if (results.some(isThenable)) {
    return Promise.all(results).then((r) => r.every(Boolean));
  }
  return (results as boolean[]).every(Boolean);
}

class Validator {
  private rules: ValidatorFn[] = [];
  private _required = false;

  private add(fn: ValidatorFn): Validator {
    this.rules.push(fn);
    return this;
  }

  //  Modifiers

  required(): Validator {
    this._required = true;
    return this;
  }
  optional(): Validator {
    this._required = false;
    return this;
  }

  //  Type checks

  string(): Validator {
    return this.add((v) => typeof v === 'string');
  }
  number(): Validator {
    return this.add((v) => typeof v === 'number' && !isNaN(v));
  }
  boolean(): Validator {
    return this.add((v) => typeof v === 'boolean');
  }
  array(): Validator {
    return this.add((v) => Array.isArray(v));
  }
  object(): Validator {
    return this.add((v) => typeof v === 'object' && v !== null && !Array.isArray(v));
  }

  //  String rules

  min(n: number): Validator {
    return this.add((v) => (typeof v === 'string' ? v.length >= n : typeof v === 'number' ? v >= n : false));
  }
  max(n: number): Validator {
    return this.add((v) => (typeof v === 'string' ? v.length <= n : typeof v === 'number' ? v <= n : false));
  }
  length(n: number): Validator {
    return this.add((v) => typeof v === 'string' && v.length === n);
  }
  regex(pattern: RegExp): Validator {
    return this.add((v) => typeof v === 'string' && pattern.test(v));
  }
  email(): Validator {
    return this.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  uuid(): Validator {
    return this.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
  trim(): Validator {
    return this.add((v) => typeof v === 'string' && v === v.trim());
  }
  url(): Validator {
    return this.add((v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    });
  }
  objectId(): Validator {
    return this.add((v) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v));
  }

  //  Number rules

  integer(): Validator {
    return this.add((v) => Number.isInteger(v));
  }
  positive(): Validator {
    return this.add((v) => typeof v === 'number' && v > 0);
  }
  negative(): Validator {
    return this.add((v) => typeof v === 'number' && v < 0);
  }

  //  Generic rules

  enum<T>(...values: T[]): Validator {
    return this.add((v) => values.includes(v));
  }
  custom(fn: ValidatorFn): Validator {
    return this.add(fn);
  }

  //  Object rules

  shape(schema: Record<string, ValidatorFn>): Validator {
    return this.add((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false;
      }
      return every(
        Object.entries(schema).map(
          ([
            key,
            fn,
          ]) => fn(v[key], v),
        ),
      );
    });
  }

  minKeys(n: number): Validator {
    return this.add((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length >= n);
  }

  maxKeys(n: number): Validator {
    return this.add((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length <= n);
  }

  // At least one of the listed keys must be present and non-empty
  or(...keys: string[]): Validator {
    return this.add((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false;
      }
      return keys.some((k) => v[k] !== undefined && v[k] !== null && v[k] !== '');
    });
  }

  // Exactly one of the listed keys must be present and non-empty
  xor(...keys: string[]): Validator {
    return this.add((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false;
      }
      const present = keys.filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== '');
      return present.length === 1;
    });
  }

  //  Cross-property conditional rules

  // when(key, is, then, otherwise?)
  // e.g. when('type', 'email', v => validate.string().email().build()(v.address))
  when(key: string, is: any, then: ValidatorFn, otherwise?: ValidatorFn): Validator {
    return this.add((v, root) => {
      const ctx = root ?? v;
      if (typeof ctx !== 'object' || ctx === null) {
        return true;
      }
      const matches = Array.isArray(is) ? is.includes(ctx[key]) : ctx[key] === is;
      if (matches) return then(v, ctx);
      if (otherwise) return otherwise(v, ctx);
      return true;
    });
  }

  // switch-case style: .match('status', { active: fn, inactive: fn }, fallbackFn?)
  match(key: string, cases: Record<string, ValidatorFn>, fallback?: ValidatorFn): Validator {
    return this.add((v, root) => {
      const ctx = root ?? v;
      if (typeof ctx !== 'object' || ctx === null) {
        return true;
      }
      const caseKey = String(ctx[key]);
      // own keys only: 'constructor', 'toString', ... must not resolve to Object.prototype
      const fn = Object.prototype.hasOwnProperty.call(cases, caseKey) ? cases[caseKey] : fallback;
      if (!fn) {
        return true;
      }
      return fn(v, ctx);
    });
  }

  //  Array rules

  items(fn: ValidatorFn): Validator {
    return this.add((v) => {
      if (!Array.isArray(v)) {
        return false;
      }
      return every(v.map((item) => fn(item)));
    });
  }

  minItems(n: number): Validator {
    return this.add((v) => Array.isArray(v) && v.length >= n);
  }
  maxItems(n: number): Validator {
    return this.add((v) => Array.isArray(v) && v.length <= n);
  }
  unique(): Validator {
    return this.add((v) => Array.isArray(v) && new Set(v).size === v.length);
  }

  //  Build

  build(): (input: any, root?: any) => Promise<boolean> {
    const rules = [...this.rules];
    const required = this._required;
    return async (input: any, root?: any): Promise<boolean> => {
      const isEmpty = input === null || input === undefined || input === '';
      if (isEmpty) {
        return !required;
      }
      for (const rule of rules) {
        const ok = await rule(input, root);
        if (!ok) {
          return false;
        }
      }
      return true;
    };
  }

  // Same semantics as build(), but returns a plain boolean. Throws if any rule
  // is async: eagerly for async functions passed to custom()/when()/match(),
  // and at call time for any rule that returns a Promise.
  buildSync(): SyncValidatorFn {
    const rules = [...this.rules];
    const required = this._required;
    if (rules.some(isAsyncFunction)) {
      throw new Error(ASYNC_RULE_ERROR);
    }
    return (input: any, root?: any): boolean => {
      const isEmpty = input === null || input === undefined || input === '';
      if (isEmpty) {
        return !required;
      }
      for (const rule of rules) {
        const ok = rule(input, root);
        if (isThenable(ok)) {
          // avoid an unhandled rejection from the promise we are discarding
          Promise.resolve(ok).catch((): undefined => undefined);
          throw new Error(ASYNC_RULE_ERROR);
        }
        if (!ok) {
          return false;
        }
      }
      return true;
    };
  }
}

//  Entry point

export const validate = {
  string: () => new Validator().string(),
  number: () => new Validator().number(),
  boolean: () => new Validator().boolean(),
  array: () => new Validator().array(),
  object: () => new Validator().object(),
  custom: (fn: ValidatorFn) => new Validator().custom(fn),
};
