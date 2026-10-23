// Registry keys used to be constructor.name, so two classes called e.g.
// `CreateDto` in different modules shared (and merged) one entry. Each class
// now gets a unique key; the name is kept in it only for readable debugging.
const classIds: WeakMap<object, string> = new WeakMap<object, string>();
let nextClassId: number = 0;

export function classKey(ctor: object): string {
  let key: string | undefined = classIds.get(ctor);
  if (!key) {
    nextClassId += 1;
    key = `${(ctor as { name?: string }).name || 'anonymous'}#${nextClassId}`;
    classIds.set(ctor, key);
  }
  return key;
}

// key for a decorated method: target is the class prototype
export function memberKey(target: { constructor: object }, method: string): string {
  return `${classKey(target.constructor)}.${method}`;
}
