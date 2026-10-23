function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Reads a dot/bracket path such as `auth.user.id` or `list[1].id`.
 * Returns undefined as soon as any step is missing instead of throwing.
 */
export function getProperty(ctx: any, key: string): any {
  if (!key) {
    return ctx;
  }
  let target = ctx;
  const keys = key.split('.');
  let i = 0;
  while (i < keys.length) {
    if (isMissing(target)) {
      return undefined;
    }
    let check: any = keys[i].match(/\[(.*)\]/);
    if (check) {
      keys[i] = keys[i].replace(check[0], '');
      check = check[1].split('][');
      target = target[keys[i]];
      let j = 0;
      while (j < check.length) {
        if (isMissing(target)) {
          return undefined;
        }
        target = target[check[j]];
        j++;
      }
      if (i === keys.length - 1) {
        return target;
      }
    } else {
      if (i < keys.length - 1) {
        target = target[keys[i]];
      } else {
        return target[keys[i]];
      }
    }
    i++;
  }
}
