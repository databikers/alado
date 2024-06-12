import { IncomingHttpHeaders } from 'http';
import { PassThrough } from 'stream';
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
  method?: HttpMethod;
  url?: string;
  auth?: Record<string, any>;
  path?: Record<string, string>;
  headers?: IncomingHttpHeaders;
  query?: Record<string, string|string[]>;
  body?: Record<string, any>;
  files?: Record<string, {
    stream: PassThrough,
    size: number,
    mimetype: string
  }>;
}

