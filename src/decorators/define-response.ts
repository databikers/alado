import { injector } from '@injector';
import { Response } from '@dto';

export function defineResponse(res: Response<any>) {
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = `${controller.constructor.name}.${method}`;
    injector.injected.responseMapping[key] = res;
  };
}
