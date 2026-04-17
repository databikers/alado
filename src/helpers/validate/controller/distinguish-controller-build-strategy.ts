function isClass(value: any): boolean {
  return typeof value === 'function' && /^\s*class\s/.test(Function.prototype.toString.call(value));
}

function isPlainObject(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function distinguishControllerBuildStrategy(input: any): 'simple' | 'complex' {
  if (isClass(input)) {
    return 'simple';
  }

  if (isPlainObject(input) && isClass(input?.controller) && Array.isArray(input?.options)) {
    return 'complex';
  }

  throw new Error('Input must be a class or plain object { controller: ControllerClass, options: any[] }');
}
