import console from 'console';
export interface AladoServerLogger {
  log: (...args: any[]) => void;
  error: (error: Error) => void;
}
