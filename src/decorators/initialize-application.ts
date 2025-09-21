import { AladoServerOptions, InitializeApplicationOptions } from '@options';
import { injector } from '@injector';
import { DEFAULT_ID } from '@const';
import { AladoServer } from '@alado';
import { initializeInjector } from './initialize-injector';

export function initializeApplication(initializeApplicationOptions: InitializeApplicationOptions): AladoServer {
  initializeInjector();
  const { serverOptions, controllers } = initializeApplicationOptions;
  injector.injected.appMapping[serverOptions.appId || DEFAULT_ID] =
    injector.injected.appMapping[serverOptions.appId || DEFAULT_ID] || new AladoServer(serverOptions);
  const app: AladoServer = injector.injected.appMapping[serverOptions.appId || DEFAULT_ID];
  for (const Controller of controllers) {
    new Controller();
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
