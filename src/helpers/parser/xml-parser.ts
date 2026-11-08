type XmlValue = string | XmlObject | XmlValue[];
type XmlObject = { [key: string]: XmlValue };

type NamespaceScope = {
  defaultUri: string | null;
  prefixes: { [prefix: string]: string };
};

// Same keys the JSON body parser drops: assigning them on a plain object can
// replace its prototype (__proto__) or shadow built-ins.
const unsafeKeys: Set<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

// Elements are parsed recursively: without a limit, deep nesting ends in a RangeError whose
// message ("Maximum call stack size exceeded") reaches the client. Real documents stay far below it.
export const MAX_XML_DEPTH: number = 256;

function removeSections(input: string, open: string, close: string, keepContent: boolean): string {
  let output: string = '';
  let from: number = 0;
  let start: number = input.indexOf(open);
  while (start !== -1) {
    const end: number = input.indexOf(close, start + open.length);
    if (end === -1) {
      break;
    }
    output += input.slice(from, start);
    if (keepContent) {
      output += input.slice(start + open.length, end);
    }
    from = end + close.length;
    start = input.indexOf(open, from);
  }
  return output + input.slice(from);
}

type XmlAttribute = { name: string; value?: string; end: number };

const attributeNameStartRegExp: RegExp = /[a-zA-Z_:]/g;
const attributeNameRestRegExp: RegExp = /[\w:.-]*/y;

function skipSpaces(text: string, from: number): number {
  let i: number = from;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

/**
 * The next `name="value"` / `name='value'` in a tag from `from` on, or null when no name is left.
 * A name without a value is returned without `value`, with `end` after the name, so the caller
 * resumes there. Same matches as the former /(name)\s*=\s*"([^"]*)"|.../g RegExp, but every
 * character is read once: the RegExp retried each failed name from every one of its characters,
 * so a long run of name characters without "=" cost quadratic time (40 KB took ~4 s).
 */
function nextAttribute(text: string, from: number): XmlAttribute | null {
  attributeNameStartRegExp.lastIndex = from;
  const start: RegExpExecArray | null = attributeNameStartRegExp.exec(text);
  if (start === null) {
    return null;
  }
  attributeNameRestRegExp.lastIndex = start.index + 1;
  attributeNameRestRegExp.exec(text);
  const nameEnd: number = attributeNameRestRegExp.lastIndex;
  const name: string = text.slice(start.index, nameEnd);
  // a match starting later inside the same name would end at the same place, so it fails too
  let i: number = skipSpaces(text, nameEnd);
  if (text[i] === '=') {
    i = skipSpaces(text, i + 1);
    const quote: string = text[i];
    if (quote === '"' || quote === "'") {
      const close: number = text.indexOf(quote, i + 1);
      if (close !== -1) {
        return { name, value: text.slice(i + 1, close), end: close + 1 };
      }
    }
  }
  return { name, end: nameEnd };
}

export function xmlParser(xmlInput: string): XmlObject {
  let xml: string = xmlInput;
  let pos: number = 0;

  xml = xml.replace(/<\?xml[^?]*\?>/g, '');
  xml = removeSections(xml, '<!--', '-->', false);
  xml = xml.trim();

  if (!xml) {
    return {};
  }

  function skipWhitespace(): void {
    while (pos < xml.length && /\s/.test(xml[pos])) {
      pos++;
    }
  }

  function parseAttributes(tagContent: string): { [key: string]: string } {
    const attrs: { [key: string]: string } = {};
    let i: number = 0;
    for (;;) {
      const attribute: XmlAttribute | null = nextAttribute(tagContent, i);
      if (attribute === null) {
        break;
      }
      if (attribute.value !== undefined && !unsafeKeys.has(attribute.name)) {
        attrs[attribute.name] = decodeEntities(attribute.value);
      }
      i = attribute.end;
    }
    return attrs;
  }

  function decodeEntities(str: string): string {
    return removeSections(str, '<![CDATA[', ']]>', true)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function resolveScope(
    rawAttrs: { [key: string]: string },
    parentScope: NamespaceScope,
  ): { scope: NamespaceScope; dataAttrs: { [key: string]: string } } {
    const scope: NamespaceScope = {
      defaultUri: parentScope.defaultUri,
      prefixes: parentScope.prefixes,
    };
    const dataAttrs: { [key: string]: string } = {};

    for (const [
      key,
      value,
    ] of Object.entries(rawAttrs)) {
      if (key === 'xmlns') {
        scope.defaultUri = value;
      } else if (key.startsWith('xmlns:')) {
        const prefix = key.slice('xmlns:'.length);
        if (scope.prefixes === parentScope.prefixes) {
          scope.prefixes = Object.create(parentScope.prefixes);
        }
        scope.prefixes[prefix] = value;
      } else {
        dataAttrs[key] = value;
      }
    }

    return { scope, dataAttrs };
  }

  function resolveTagNamespace(
    tagName: string,
    scope: NamespaceScope,
  ): { localName: string; namespaceUri: string | null } {
    const colonIndex = tagName.indexOf(':');

    if (colonIndex === -1) {
      return { localName: tagName, namespaceUri: scope.defaultUri };
    }

    const prefix: string = tagName.slice(0, colonIndex);
    const localName: string = tagName.slice(colonIndex + 1);
    const namespaceUri: string = scope.prefixes[prefix] ?? null;

    return { localName, namespaceUri };
  }

  function addChild(parent: XmlObject, key: string, value: XmlValue): void {
    if (unsafeKeys.has(key)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      const existing = parent[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        parent[key] = [
          existing,
          value,
        ];
      }
    } else {
      parent[key] = value;
    }
  }

  // length of `</tagName>` (whitespace allowed before '>') at pos, or 0. Compared as a string:
  // compiling a RegExp per element costs a regexp compilation for every distinct tag name, and
  // when that compilation runs out of stack V8 aborts the process instead of throwing.
  function closingTagLength(tagName: string): number {
    if (!xml.startsWith('</', pos) || !xml.startsWith(tagName, pos + 2)) {
      return 0;
    }
    let end: number = pos + 2 + tagName.length;
    while (end < xml.length && /\s/.test(xml[end])) {
      end++;
    }
    return xml[end] === '>' ? end + 1 - pos : 0;
  }

  function parseElement(
    parentScope: NamespaceScope,
    depth: number = 1,
  ):
    | [
        string,
        XmlValue,
      ]
    | null {
    skipWhitespace();

    if (xml[pos] !== '<') {
      return null;
    }
    if (depth > MAX_XML_DEPTH) {
      throw new Error(`Elements are nested deeper than ${MAX_XML_DEPTH} levels`);
    }

    const tagMatch = /^<([a-zA-Z_:][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>/.exec(xml.slice(pos));
    if (!tagMatch) {
      // the message reaches the client: the position only, never the request content
      throw new Error(`Malformed XML near position ${pos}`);
    }

    const fullMatch: string = tagMatch[0];
    const rawTagName: string = tagMatch[1];
    const rawAttrsText: string = tagMatch[2];
    const selfClosing: string = tagMatch[3];
    pos += fullMatch.length;

    const rawAttrs: Record<string, string> = parseAttributes(rawAttrsText);
    const { scope, dataAttrs } = resolveScope(rawAttrs, parentScope);
    const { localName, namespaceUri } = resolveTagNamespace(rawTagName, scope);
    const hasAttrs: boolean = Object.keys(dataAttrs).length > 0;

    if (selfClosing === '/') {
      const value: XmlObject = { '@ns': namespaceUri as unknown as string };
      if (hasAttrs) {
        value['@attrs'] = dataAttrs;
      }
      return [
        localName,
        value,
      ];
    }

    const children: XmlObject = {};
    let textContent = '';
    let sawChildElement: boolean = false;
    let closed: boolean = false;

    while (pos < xml.length) {
      skipWhitespace();

      const closeLength: number = closingTagLength(rawTagName);
      if (closeLength) {
        pos += closeLength;
        closed = true;
        break;
      }

      if (xml[pos] === '<') {
        if (xml.slice(pos, pos + 9) === '<![CDATA[') {
          const end = xml.indexOf(']]>', pos);
          if (end === -1) {
            throw new Error('Unterminated CDATA section');
          }
          // CDATA is literal: no entity decoding
          textContent += xml.slice(pos + 9, end);
          pos = end + 3;
          continue;
        }

        const child = parseElement(scope, depth + 1);
        if (child) {
          const [
            childName,
            childValue,
          ] = child;
          sawChildElement = true;
          addChild(children, childName, childValue);
        }
      } else {
        const nextTag = xml.indexOf('<', pos);
        const end = nextTag === -1 ? xml.length : nextTag;
        textContent += decodeEntities(xml.slice(pos, end));
        pos = end;
      }
    }

    if (!closed) {
      // a name is only [\w:.-] characters, but its length is the client's: cut it to stay readable
      throw new Error(`Unclosed element <${rawTagName.length > 64 ? `${rawTagName.slice(0, 64)}...` : rawTagName}>`);
    }

    const trimmedText = textContent.trim();

    if (sawChildElement) {
      children['@ns'] = namespaceUri as unknown as string;
      if (hasAttrs) {
        children['@attrs'] = dataAttrs;
      }
      return [
        localName,
        children,
      ];
    }

    // Leaf node (no child elements). If there are no attributes, return a plain
    // string for ergonomics — the common case for payment-message field values
    // like <IBAN>...</IBAN> or <MsgId>...</MsgId>. Namespace on a plain-string
    // leaf is recoverable from its parent's "@ns", since a leaf can't redeclare
    // scope for anything beneath it (it has no children).
    if (!hasAttrs) {
      return [
        localName,
        trimmedText,
      ];
    }

    const leaf: XmlObject = { '@ns': namespaceUri as unknown as string, '@attrs': dataAttrs };
    if (trimmedText) {
      leaf['#text'] = trimmedText;
    }

    return [
      localName,
      leaf,
    ];
  }

  const rootScope: NamespaceScope = { defaultUri: null, prefixes: Object.create(null) };
  const root: XmlObject = {};
  const rootElement = parseElement(rootScope);

  if (rootElement) {
    const [
      rootName,
      rootValue,
    ] = rootElement;
    if (!unsafeKeys.has(rootName)) {
      root[rootName] = rootValue;
    }
  }

  return root;
}
