type ValidatorFn = (input: any, root?: any) => boolean | Promise<boolean>;

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
    return this.add(async (v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false;
      }
      const results = await Promise.all(
        Object.entries(schema).map(
          ([
            key,
            fn,
          ]) => fn(v[key], v),
        ),
      );
      return results.every(Boolean);
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
    return this.add(async (v) => {
      if (!Array.isArray(v)) {
        return false;
      }
      const results = await Promise.all(v.map((item) => fn(item)));
      return results.every(Boolean);
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
