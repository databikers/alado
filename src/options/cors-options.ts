export interface CorsOptions {
  enable: boolean;
  allowedOrigin?: string | string[];
  allowedMethods?: Map<any, any>;
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  allowedCredentials?: boolean;
  maxAge?: number;
}
