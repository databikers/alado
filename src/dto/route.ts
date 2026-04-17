import { Context } from './context';
import { Request } from './request';

export type Route<T> = {
  route: RegExp;
  path: Record<string, string>;
  context: Context<T>;
  handler: (request: Request) => any;
  allowedMethods?: string[];
};
