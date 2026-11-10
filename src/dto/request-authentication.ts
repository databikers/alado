import { AladoServerError } from './alado-server-error';

export type RequestAuthentication = {
  inputProperty: string;
  outputProperty: string;
  handler: (value: any) => any | Promise<any>;
  handlerContext?: any;
  /**
   * Whether a request without valid credentials is refused. Defaults to true: leaving it out, or any
   * value other than an explicit `false`, refuses the request with `error`. Only `required: false`
   * lets requests through anonymously (nothing at outputProperty).
   */
  required?: boolean;
  error: AladoServerError;
};
