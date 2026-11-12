import { ContextOptions } from '@options';
import { ContextAuth } from './request-authentication';
import { Response } from './response';
import { ContextRequest } from './request';
import { AccessControlConfig } from './access-control-config';

export type Context<T> = {
  title: string;
  auth?: ContextAuth;
  accessControl?: AccessControlConfig<any>[];
  options: ContextOptions;
  request: ContextRequest;
  response: Response<Record<keyof T, any>>;
};
