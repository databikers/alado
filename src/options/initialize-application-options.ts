import { AladoServerOptions } from './alado-server-options';

export type AnyClass = new (...args: any[]) => any;

export type InitializeApplicationOptions = {
  serverOptions: AladoServerOptions;
  controllers: AnyClass[];
};
