const data: Map<string | symbol, any> = new Map<string, any>();

const inject = <T>(sourceObject: Partial<T>): void => {
  for (const property in sourceObject) {
    data.set(property as string, sourceObject[property]);
  }
};

const injected: Record<string, any> = new Proxy(
  {},
  {
    get: (target, property, receiver) => {
      if (data.has(property as string)) {
        return data.get(property as string);
      }
    },
  },
);

export class Injector<T> {
  public inject(data: Partial<T>) {
    return inject<T>(data);
  }

  public get injected() {
    return injected as T;
  }
}
