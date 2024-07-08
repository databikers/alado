export const inputPropertyRegexp = /^(headers|body|query|path)(\.\w+)$/;
export const outputPropertyRegexp = /^auth(\.\w+)?$/;

export const startRouteRegexp: RegExp = /^\//;
export const trimRouteRegexp: RegExp = /\/$/;
export const multiSlashRegExp: RegExp = /\/+/g;

export const spaceRegExp: RegExp = /^\s+|\s+$/;

export const formDataRegExp: Record<string, RegExp> = {
  name: /name="(.+?)"/,
  value: /\r\n\r\n([\S\s]*)\r\n--$/,
  filename: /filename="(.*?)"/,
  mimetype: /Content-Type:(.*?)\r\n/,
};

export const deprecatedJsonPropertiesRegExp = /\.?(__(proto|defineGetter|defineSetter)__|(prototype|constructor))/;
