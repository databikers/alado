// Members whose route was registered the moment its HTTP decorator ran (the application already
// existed). Decorators apply bottom-up, so one written above @get/@post/... runs after that and
// its configuration would never reach the route.
const registeredMembers: Set<string> = new Set<string>();

export function markRegistered(key: string): void {
  registeredMembers.add(key);
}

export function assertNotRegistered(key: string, decorator: string): void {
  if (registeredMembers.has(key)) {
    throw new Error(
      `@${decorator} on ${key} is applied after its route was registered, so it would be ignored. ` +
        `Place the HTTP method decorator (@get, @post, ...) above every other decorator of the method.`,
    );
  }
}
