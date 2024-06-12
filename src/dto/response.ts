export interface Response<T>  {
  title?: string;
  description?: string;
  statusCode: number;
  headers?: Record<string, string>;
  body?: T
}
