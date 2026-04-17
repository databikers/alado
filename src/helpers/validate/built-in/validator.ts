type ValidatorFn = (input: any) => boolean;

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
    return this.add((v: any) => typeof v === 'string');
  }
  number(): Validator {
    return this.add((v: any) => typeof v === 'number' && !isNaN(v));
  }
  boolean(): Validator {
    return this.add((v: any) => typeof v === 'boolean');
  }
  array(): Validator {
    return this.add((v: any) => Array.isArray(v));
  }
  object(): Validator {
    return this.add((v: any) => typeof v === 'object' && v !== null && !Array.isArray(v));
  }

  //  String rules

  min(n: number): Validator {
    return this.add((v: any) => (typeof v === 'string' ? v.length >= n : typeof v === 'number' ? v >= n : false));
  }

  max(n: number): Validator {
    return this.add((v: any) => (typeof v === 'string' ? v.length <= n : typeof v === 'number' ? v <= n : false));
  }

  length(n: number): Validator {
    return this.add((v: any) => typeof v === 'string' && v.length === n);
  }
  regex(pattern: RegExp): Validator {
    return this.add((v: any) => typeof v === 'string' && pattern.test(v));
  }
  email(): Validator {
    return this.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  uuid(): Validator {
    return this.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
  trim(): Validator {
    return this.add((v: any) => typeof v === 'string' && v === v.trim());
  }
  url(): Validator {
    return this.add((v: any) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    });
  }

  objectId(): Validator {
    return this.add((v: any) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v));
  }

  //  Number rules

  integer(): Validator {
    return this.add((v: any) => Number.isInteger(v));
  }
  positive(): Validator {
    return this.add((v: any) => typeof v === 'number' && v > 0);
  }
  negative(): Validator {
    return this.add((v: any) => typeof v === 'number' && v < 0);
  }

  //  Generic rules

  enum<T>(...values: T[]): Validator {
    return this.add((v: any) => values.includes(v));
  }
  custom(fn: ValidatorFn): Validator {
    return this.add(fn);
  }

  //  Object rules

  shape(schema: Record<string, ValidatorFn>): Validator {
    return this.add((v: any) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      return Object.entries(schema).every(
        ([
          key,
          fn,
        ]) => fn(v[key]),
      );
    });
  }

  //  Array rules

  items(fn: ValidatorFn): Validator {
    return this.add((v: any) => Array.isArray(v) && v.every(fn));
  }

  minItems(n: number): Validator {
    return this.add((v: any) => Array.isArray(v) && v.length >= n);
  }
  maxItems(n: number): Validator {
    return this.add((v: any) => Array.isArray(v) && v.length <= n);
  }
  unique(): Validator {
    return this.add((v: any) => Array.isArray(v) && new Set(v).size === v.length);
  }

  //  Build─

  build(): ValidatorFn {
    const rules = [...this.rules];
    const required = this._required;

    return (input: any): boolean => {
      const isEmpty = input === null || input === undefined || input === '';
      if (isEmpty) return !required;
      return rules.every((rule) => rule(input));
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
