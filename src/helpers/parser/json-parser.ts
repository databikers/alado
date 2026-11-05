import { deprecatedJsonPropertiesHintRegExp, deprecatedJsonPropertiesRegExp } from '@const';

// Same limit as XML. JSON.parse itself copes with deeper input, but every recursive consumer after
// it (validators, transforms, JSON.stringify of a response) overflows the stack far earlier.
// Real documents stay far below it.
export const MAX_JSON_DEPTH: number = 256;

export class JsonDepthError extends Error {
  constructor() {
    super(`nested deeper than ${MAX_JSON_DEPTH} levels`);
    this.name = 'JsonDepthError';
  }
}

/**
 * Whether arrays and objects nest deeper than `limit` (the outermost one is level 1). Reads the
 * text, not the parsed value, so a deep document is refused before JSON.parse spends time building
 * it, and stops at the first level past the limit. Brackets inside strings do not count.
 */
export function jsonDepthExceeds(text: string, limit: number = MAX_JSON_DEPTH): boolean {
  // every level takes an opening and a closing bracket
  if (text.length <= 2 * limit) {
    return false;
  }
  let depth: number = 0;
  let inString: boolean = false;
  for (let i = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    if (inString) {
      if (code === 92) {
        // backslash: the next character is escaped (\" does not end the string)
        i++;
      } else if (code === 34) {
        inString = false;
      }
    } else if (code === 34) {
      inString = true;
    } else if (code === 91 || code === 123) {
      if (++depth > limit) {
        return true;
      }
    } else if (code === 93 || code === 125) {
      depth--;
    }
  }
  return false;
}

/**
 * Deletes forbidden keys (__proto__, constructor, ...) from a JSON.parse result, at any depth.
 * Iterative, so no nesting depth can overflow the stack. JSON.parse defines "__proto__" as an own
 * data property, so `delete` removes it without touching the prototype.
 */
export function removeForbiddenKeys(root: unknown): void {
  if (root === null || typeof root !== 'object') {
    return;
  }
  const stack: any[] = [root];
  while (stack.length) {
    const node: any = stack.pop();
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const value: unknown = node[i];
        if (value !== null && typeof value === 'object') {
          stack.push(value);
        }
      }
      continue;
    }
    for (const key of Object.keys(node)) {
      if (deprecatedJsonPropertiesRegExp.test(key)) {
        delete node[key];
        continue;
      }
      const value: unknown = node[key];
      if (value !== null && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
}

/**
 * JSON.parse without forbidden keys and without nesting deeper than MAX_JSON_DEPTH (JsonDepthError).
 * A reviver would take V8 off its fast JSON path and run for every value (about 7x slower on a
 * 1 MB body); parsing plainly and walking the result afterwards, only when the text can contain
 * such a key, gives the same result.
 */
export function parseJson(text: string): unknown {
  if (jsonDepthExceeds(text)) {
    throw new JsonDepthError();
  }
  const value: unknown = JSON.parse(text);
  if (deprecatedJsonPropertiesHintRegExp.test(text)) {
    removeForbiddenKeys(value);
  }
  return value;
}
