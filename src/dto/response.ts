export type ResponseError = {
  message: string
}

export interface Response<T> {
  title?: string;
  description?: string;
  statusCode: number;
  headers?: Record<string, string>;
  body?: T | ResponseError;
}
