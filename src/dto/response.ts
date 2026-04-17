export type ResponseError = {
  message: string;
};

export type Response<T> = {
  title?: string;
  entity?: string;
  description?: string;
  statusCode: number;
  headers?: Record<string, string>;
  body?: T | ResponseError;
};
