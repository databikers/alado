type XmlValue = string | XmlObject | XmlValue[];
type XmlObject = { [key: string]: XmlValue };

type NamespaceScope = {
  defaultUri: string | null;
  prefixes: { [prefix: string]: string };
};

export function xmlParser(xmlInput: string): XmlObject {
  let xml: string = xmlInput;
  let pos: number = 0;

  xml = xml.replace(/<\?xml[^?]*\?>/g, '');
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
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
    const attrRegex: RegExp = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][\w:.-]*)\s*=\s*'([^']*)'/g;
    let match: RegExpExecArray | null;

    match = attrRegex.exec(tagContent);
    while (match !== null) {
      const name: string = match[1] || match[3];
      const value: string = match[2] !== undefined ? match[2] : match[4];
      attrs[name] = decodeEntities(value);
      match = attrRegex.exec(tagContent);
    }
    return attrs;
  }

  function decodeEntities(str: string): string {
    return str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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
      prefixes: { ...parentScope.prefixes },
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

  function parseElement(parentScope: NamespaceScope):
    | [
        string,
        XmlValue,
      ]
    | null {
    skipWhitespace();

    if (xml[pos] !== '<') {
      return null;
    }

    const tagMatch = /^<([a-zA-Z_:][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>/.exec(xml.slice(pos));
    if (!tagMatch) {
      throw new Error(`Malformed XML near position ${pos}: ${xml.slice(pos, pos + 40)}`);
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

    while (pos < xml.length) {
      skipWhitespace();

      const closeMatch: RegExpExecArray = new RegExp(`^</${rawTagName}\\s*>`).exec(xml.slice(pos));
      if (closeMatch) {
        pos += closeMatch[0].length;
        break;
      }

      if (xml[pos] === '<') {
        if (xml.slice(pos, pos + 9) === '<![CDATA[') {
          const end = xml.indexOf(']]>', pos);
          if (end === -1) {
            throw new Error('Unterminated CDATA section');
          }
          textContent += xml.slice(pos + 9, end);
          pos = end + 3;
          continue;
        }

        const child = parseElement(scope);
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
        textContent += xml.slice(pos, end);
        pos = end;
      }
    }

    const trimmedText = decodeEntities(textContent.trim());

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

  const rootScope: NamespaceScope = { defaultUri: null, prefixes: {} };
  const root: XmlObject = {};
  const rootElement = parseElement(rootScope);

  if (rootElement) {
    const [
      rootName,
      rootValue,
    ] = rootElement;
    root[rootName] = rootValue;
  }

  return root;
}
