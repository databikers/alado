import { AladoServerError } from './alado-server-error';

export type RequestAuthentication = {
  inputProperty: string;
  outputProperty: string;
  handler: (value: any) => any | Promise<any>;
  handlerContext?: any;
  required: boolean;
  error: AladoServerError;
};
