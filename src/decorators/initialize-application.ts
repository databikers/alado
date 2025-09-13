import { AladoServerOptions } from '@options';
import { injector } from '../injector';
import { DEFAULT_ID } from '@const';
import { AladoServer } from '@alado';

export function initializeInjector() {
  injector.inject({
    appMapping: injector.injected.appMapping || {},
    requestMapping: injector.injected.requestMapping || {},
    responseMapping: injector.injected.responseMapping || {},
    authMapping: injector.injected.authMapping || {},
    propertyDefinitionsMapping: injector.injected.propertyDefinitionsMapping || {},
  });
}

export function initializeApplication(aladoServerOptions: AladoServerOptions): AladoServer {
  initializeInjector();
  injector.injected.appMapping[aladoServerOptions.appId || DEFAULT_ID] =
    injector.injected.appMapping[aladoServerOptions.appId || DEFAULT_ID] || new AladoServer(aladoServerOptions);
  return injector.injected.appMapping[aladoServerOptions.appId || DEFAULT_ID];
}
