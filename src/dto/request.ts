import { IncomingHttpHeaders, IncomingMessage } from 'http';
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

/** A file of a multipart request. */
export interface UploadedFile {
  stream: Readable;
  // byte length of the content
  size: number;
  // the part's Content-Type; application/octet-stream when the client sent none
  mimetype: string;
  // the name the client sent (filename="..."), unchecked: never use it as a path as is
  filename: string;
}

export interface Request {
  request: IncomingMessage;
  ip?: string;
  origin?: string;
  method?: HttpMethod;
  url?: string;
  auth?: Record<string, any>;
  path?: Record<string, string>;
  headers?: IncomingHttpHeaders;
  query?: Record<string, any>;
  body?: Record<string, any>;
  rawBody?: string;
  // with parsing.repeatedFiles: 'array', a field sent several times (or as name[]) holds an UploadedFile[]
  files?: Record<string, UploadedFile>;
}
