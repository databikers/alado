import { AladoServerOptions } from './alado-server-options';

export type AnyClass = new (...args: any[]) => any;
export type TypedArgsClass<TypedArgs extends any[] = any[]> = new (...args: TypedArgs) => any;

export type ControllerFactory<Controller extends AnyClass, Args extends any[]> = {
  controller: TypedArgsClass<Args>;
  options: Args;
};

export type InitializeApplicationOptions = {
  serverOptions: AladoServerOptions;
  controllers: (ControllerFactory<AnyClass, any> | AnyClass)[];
};
