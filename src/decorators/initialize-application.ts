import { AnyClass, ControllerFactory, InitializeApplicationOptions } from '@options';
import { injector } from '@injector';
import { DEFAULT_ID } from '@const';
import { AladoServer } from '@alado';
import { initializeInjector } from './initialize-injector';
import { distinguishControllerBuildStrategy } from '@helper';

export function initializeApplication(initializeApplicationOptions: InitializeApplicationOptions): AladoServer {
  initializeInjector();
  const { serverOptions, controllers } = initializeApplicationOptions;
  injector.injected.appMapping[serverOptions.appId || DEFAULT_ID] =
    injector.injected.appMapping[serverOptions.appId || DEFAULT_ID] || new AladoServer(serverOptions);
  const app: AladoServer = injector.injected.appMapping[serverOptions.appId || DEFAULT_ID];
  for (const data of controllers) {
    const strategy = distinguishControllerBuildStrategy(data);
    let controller: AnyClass;
    let options: any[] = [];
    switch (strategy) {
      case 'simple':
        controller = data as AnyClass;
        break;
      case 'complex':
        controller = (data as ControllerFactory<AnyClass, any>).controller;
        options = (data as ControllerFactory<AnyClass, any>).options;
        break;
    }
    if (controller) {
      new controller(...options);
    }
  }
  const shadowApp = injector.injected.shadowAppMapping[serverOptions.appId || DEFAULT_ID];
  if (Array.isArray(shadowApp) && shadowApp.length) {
    while (shadowApp.length) {
      const fn = shadowApp.pop();
      fn(app);
    }
  }
  return app;
}
