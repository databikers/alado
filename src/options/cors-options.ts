/**
 * The allowed origins as they are now: one origin, a list, or '*'. Called synchronously for every
 * CORS request, so it should only read a value kept up to date elsewhere (a partner list reloaded
 * in the background), never wait for a lookup.
 */
export type CorsOriginList = () => string | string[];

export type CorsOptions = {
  enable: boolean;
  allowedOrigin?: string | string[] | CorsOriginList;
  allowedMethods?: Map<any, any>;
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  allowedCredentials?: boolean;
  maxAge?: number;
};
