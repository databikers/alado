export interface CorsOptions {
  enable: boolean;
  allowedOrigin?: string;
  allowedMethods?: any;
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  allowedCredentials?: boolean;
  maxAge?: number;
}
