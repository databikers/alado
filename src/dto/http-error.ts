/**
 * An error meant for the client: thrown from a handler (or anything it calls), it is answered with
 * its status and message. Other Error objects are answered with a generic 500, whatever properties
 * they carry: an error from a library or an SDK often has a `statusCode` and a message describing
 * internals (hosts, resource names), which must not reach the client.
 */
export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}
