import console from 'console';
// methods may be sync or async; a promise they return is watched for rejection, not awaited
export interface AladoServerLogger {
  log: (...args: any[]) => void | Promise<unknown>;
  error: (error: Error) => void | Promise<unknown>;
}
