import { ContextOptions } from '@options';
import { RequestAuthentication } from './request-authentication';
import { Response } from './response';
import { ContextRequest } from './request';

export interface Context<T> {
  title: string;
  auth?: RequestAuthentication;
  options: ContextOptions;
  request: ContextRequest;
  response: Response<Record<keyof T, any>>;
}
