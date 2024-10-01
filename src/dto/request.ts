import { IncomingHttpHeaders } from 'http';
import { Readable } from 'stream';
import { FilePropertyDefinition, PropertyDefinition } from './property-definition';
import { HttpMethod } from '@const';

export interface ContextRequest {
  headers?: Record<string, PropertyDefinition>;
  query?: Record<string, PropertyDefinition>;
  path?: Record<string, PropertyDefinition>;
  body?: Record<string, PropertyDefinition>;
  files?: Record<string, FilePropertyDefinition>;
  auth?: Record<string, any>;
}

export interface Request {
  ip?: string;
  method?: HttpMethod;
  url?: string;
  auth?: Record<string, any>;
  path?: Record<string, string>;
  headers?: IncomingHttpHeaders;
  query?: Record<string, any>;
  body?: Record<string, any>;
  rawBody?: string;
  files?: Record<
    string,
    {
      stream: Readable;
      size: number;
      mimetype: string;
    }
  >;
}
