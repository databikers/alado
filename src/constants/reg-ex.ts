export const inputPropertyRegex = /^(headers|body|query|path)(\.\w+)$/;
export const outputPropertyRegex = /^auth(\.\w+)?$/;

export const startRouteRegex: RegExp = /^\//;
export const trimRouteRegex: RegExp = /\/$/;
export const multiSlashRegEx: RegExp = /\/+/g;
