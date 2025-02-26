import { RequestAuthentication } from './request-authentication';
import { ContextOptions } from '@options';
import { ContextRequest } from './request';
import { Response } from './response';

export type GlobalHolder = {
  title: Record<string, string>;
  auth: Record<string, RequestAuthentication>;
  options: Record<string, ContextOptions>;
  request: Record<string, ContextRequest>;
  response: Record<string, Response<Record<string, any>>>;
}
