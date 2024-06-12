import { Context } from './context';
import { Request } from './request';

export interface Route<T> {
  route: RegExp;
  path: Record<string, string>;
  context: Context<T>;
  handler: (request: Request) => any;
  allowedMethods?: string[];
}
