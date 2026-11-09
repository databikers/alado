export type AladoConfigurationErrorCode =
  'ROUTE_ALREADY_REGISTERED' | 'ROUTE_RESERVED_FOR_OPEN_API' | 'HEADER_DECLARED_TWICE';

/**
 * Thrown while the application is being set up (never for a request): the configuration cannot
 * work as written. `code` tells the cases apart without matching the message.
 */
export class AladoConfigurationError extends Error {
  public readonly code: AladoConfigurationErrorCode;

  constructor(code: AladoConfigurationErrorCode, message: string) {
    super(message);
    this.name = 'AladoConfigurationError';
    this.code = code;
  }
}
