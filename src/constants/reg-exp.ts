export const inputPropertyRegexp = /^(headers|body|query|path)(\.[\w-]+)$/;
export const outputPropertyRegexp = /^auth(\.[\w-]+)?$/;

export const startRouteRegexp: RegExp = /^\//;
export const trimRouteRegexp: RegExp = /\/$/;
export const multiSlashRegExp: RegExp = /\/+/g;

export const formDataRegExp: Record<string, RegExp> = {
  name: /name="(.+?)"/,
  value: /\r\n\r\n([\S\s]*)\r\n--$/,
  filename: /filename="(.*?)"/,
  mimetype: /Content-Type:(.*?)\r\n/,
};

// keys never copied from a request body (__proto__ would replace the prototype, the others shadow built-ins);
// anchored, so fields such as "prototypeUrl" or "constructorId" are kept
export const deprecatedJsonPropertiesRegExp = /^(__proto__|__defineGetter__|__defineSetter__|prototype|constructor)$/;
// cheap test on the raw JSON text: whether one of those keys can be present at all. A \u escape
// counts too: "\u005f_proto__" only reads as __proto__ once JSON.parse has decoded it
export const deprecatedJsonPropertiesHintRegExp = /__proto__|__define[GS]etter__|prototype|constructor|\\u/;
