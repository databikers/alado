import { deprecatedJsonPropertiesHintRegExp, deprecatedJsonPropertiesRegExp } from '@const';

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
 * JSON.parse without forbidden keys. A reviver would take V8 off its fast JSON path and run for
 * every value (about 7x slower on a 1 MB body); parsing plainly and walking the result afterwards,
 * only when the text can contain such a key, gives the same result.
 */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  if (deprecatedJsonPropertiesHintRegExp.test(text)) {
    removeForbiddenKeys(value);
  }
  return value;
}
