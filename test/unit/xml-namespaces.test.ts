import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_XML_DEPTH, xmlParser } from '../../src/helpers/parser/xml-parser';

function elapsed(fn: () => unknown): number {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

describe('xmlParser namespace scopes', () => {
  it('does not copy declared prefixes into every nested element', () => {
    // 3.5.0 spent ~6.6 s on this 75 KB body
    const prefixes = Array.from({ length: 4000 }, (_, i) => `xmlns:p${i}="urn:${i}"`).join(' ');
    // nested as deep as the parser allows (the root counts as one level)
    const depth = MAX_XML_DEPTH - 1;
    const xml = `<a ${prefixes}>` + '<b>'.repeat(depth) + '</b>'.repeat(depth) + '</a>';
    const ms = elapsed(() => xmlParser(xml));
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  it('stays fast when every nested element declares and uses its own prefix', () => {
    const depth = MAX_XML_DEPTH;
    let xml = '';
    for (let i = 0; i < depth; i++) {
      xml += `<p${i}:e xmlns:p${i}="urn:${i}">`;
    }
    for (let i = depth - 1; i >= 0; i--) {
      xml += `</p${i}:e>`;
    }
    const ms = elapsed(() => xmlParser(xml));
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  it('scopes a redeclared prefix to the element that declares it', () => {
    const r: any = xmlParser(
      '<p:root xmlns:p="urn:outer"><p:inner xmlns:p="urn:inner"><p:leaf a="1"/></p:inner><p:sibling a="1"/></p:root>',
    );
    assert.equal(r.root['@ns'], 'urn:outer');
    assert.equal(r.root.inner['@ns'], 'urn:inner');
    assert.equal(r.root.inner.leaf['@ns'], 'urn:inner');
    assert.equal(r.root.sibling['@ns'], 'urn:outer');
  });

  it('resolves only declared prefixes, never built-in object properties', () => {
    const r: any = xmlParser('<constructor:a><toString:b x="1"/></constructor:a>');
    assert.equal(r.a['@ns'], null);
    assert.equal(r.a.b['@ns'], null);
  });

  it('accepts a prefix named __proto__', () => {
    const r: any = xmlParser('<__proto__:a xmlns:__proto__="urn:p"><b>1</b></__proto__:a>');
    assert.equal(r.a['@ns'], 'urn:p');
    assert.equal(({} as any).b, undefined);
  });
});
