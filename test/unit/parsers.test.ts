import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryParser, clearRoutePath, getProperty, setProperty } from '../../src/helpers';
import { xmlParser } from '../../src/helpers/parser/xml-parser';

describe('clearRoutePath', () => {
  it('adds a leading slash', () => {
    assert.equal(clearRoutePath('user'), '/user');
  });
  it('collapses repeated slashes', () => {
    assert.equal(clearRoutePath('//user///1'), '/user/1');
  });
  it('drops a trailing slash', () => {
    assert.equal(clearRoutePath('/user/'), '/user');
  });
  it('root stays empty after trimming', () => {
    assert.equal(clearRoutePath('/'), '');
  });
});

describe('queryParser', () => {
  it('returns {} for empty input', () => {
    assert.deepEqual(queryParser(''), {});
    assert.deepEqual(queryParser(undefined as any), {});
  });

  it('parses simple pairs', () => {
    assert.deepEqual(queryParser('a=1&b=two'), { a: '1', b: 'two' });
  });

  it('collects key[] into an array', () => {
    assert.deepEqual(queryParser('id[]=1&id[]=2'), {
      id: [
        '1',
        '2',
      ],
    });
  });

  it('turns a repeated key into an array', () => {
    assert.deepEqual(queryParser('tag=a&tag=b&tag=c'), {
      tag: [
        'a',
        'b',
        'c',
      ],
    });
  });

  it('skips keys without a value', () => {
    assert.deepEqual(queryParser('a=&b=1&c'), { b: '1' });
  });

  it('decodes percent-encoded values', () => {
    assert.deepEqual(queryParser('email=user%40example.com'), { email: 'user@example.com' });
  });

  it(
    'keeps an encoded & inside a value',
    { todo: 'BUG: whole string is decoded before splitting, so %26 becomes a separator' },
    () => {
      assert.deepEqual(queryParser('q=tom%26jerry'), { q: 'tom&jerry' });
    },
  );

  it('keeps = inside a value', { todo: 'BUG: part.split("=") drops everything after the second =' }, () => {
    assert.deepEqual(queryParser('token=abc%3D%3D'), { token: 'abc==' });
  });

  it(
    'keeps spaces inside a value',
    { todo: 'BUG: all whitespace is stripped from values ("New York" -> "NewYork")' },
    () => {
      assert.deepEqual(queryParser('city=New%20York'), { city: 'New York' });
    },
  );

  it(
    'throws an HTTP-mappable error on malformed encoding, not a generic URIError',
    { todo: 'BUG: decodeURIComponent throws URIError -> request ends as 500 instead of 400' },
    () => {
      try {
        queryParser('a=%E0%A4%A');
        assert.fail('expected throw');
      } catch (e: any) {
        assert.equal(e.statusCode, 400);
      }
    },
  );
});

describe('getProperty / setProperty', () => {
  it('reads nested dot paths', () => {
    const o = { headers: { authorization: 'Bearer x' } };
    assert.equal(getProperty(o, 'headers.authorization'), 'Bearer x');
  });

  it('returns undefined for a missing last branch', () => {
    assert.equal(getProperty({ auth: {} }, 'auth.user'), undefined);
  });

  it(
    'returns undefined when a middle branch is missing instead of throwing',
    { todo: 'BUG: target becomes undefined and the next step reads a property of it -> TypeError' },
    () => {
      assert.equal(getProperty({}, 'auth.user.id'), undefined);
    },
  );

  it('returns the whole object for an empty key', () => {
    const o = { a: 1 };
    assert.equal(getProperty(o, ''), o);
  });

  it('reads bracket indexes', () => {
    assert.equal(
      getProperty(
        {
          list: [
            { id: 'a' },
            { id: 'b' },
          ],
        },
        'list[1].id',
      ),
      'b',
    );
    assert.equal(
      getProperty(
        {
          list: [
            'a',
            'b',
          ],
        },
        'list[1]',
      ),
      'b',
    );
  });

  it('writes nested dot paths, creating intermediate objects', () => {
    const o: any = {};
    setProperty(o, 'auth.user', { id: 7 });
    assert.deepEqual(o, { auth: { user: { id: 7 } } });
  });

  it('writes to an existing branch without dropping siblings', () => {
    const o: any = { auth: { scope: 'read' } };
    setProperty(o, 'auth.user', { id: 7 });
    assert.deepEqual(o, { auth: { scope: 'read', user: { id: 7 } } });
  });
});

describe('xmlParser', () => {
  it('returns {} for empty or declaration-only input', () => {
    assert.deepEqual(xmlParser(''), {});
    assert.deepEqual(xmlParser('<?xml version="1.0"?>'), {});
  });

  it('turns leaf elements into plain strings without coercion', () => {
    const r: any = xmlParser('<payment><amount>10000.00</amount><id>007</id></payment>');
    assert.equal(r.payment.amount, '10000.00');
    assert.equal(r.payment.id, '007');
  });

  it('collapses repeated siblings into an array', () => {
    const r: any = xmlParser('<list><item>a</item><item>b</item><item>c</item></list>');
    assert.deepEqual(r.list.item, [
      'a',
      'b',
      'c',
    ]);
  });

  it('puts attributes under @attrs and text under #text', () => {
    const r: any = xmlParser('<tx><amount currency="USD">100</amount></tx>');
    assert.deepEqual(r.tx.amount['@attrs'], { currency: 'USD' });
    assert.equal(r.tx.amount['#text'], '100');
  });

  it('supports single-quoted attributes and self-closing tags', () => {
    const r: any = xmlParser("<a><flag on='yes'/></a>");
    assert.deepEqual(r.a.flag['@attrs'], { on: 'yes' });
  });

  it('unwraps CDATA', () => {
    const r: any = xmlParser('<note><body><![CDATA[<b>hi</b> & bye]]></body></note>');
    assert.equal(r.note.body, '<b>hi</b> & bye');
  });

  it('decodes the five predefined entities', () => {
    const r: any = xmlParser('<t><v>&lt;&gt;&quot;&apos;&amp;</v></t>');
    assert.equal(r.t.v, '<>"\'&');
  });

  it('does not double-decode &amp;lt;', () => {
    const r: any = xmlParser('<t><v>&amp;lt;</v></t>');
    assert.equal(r.t.v, '&lt;');
  });

  it('ignores comments and the XML declaration', () => {
    const r: any = xmlParser('<?xml version="1.0" encoding="UTF-8"?><!-- c --><a><b>1</b><!-- x --></a>');
    assert.deepEqual(Object.keys(r), ['a']);
    assert.equal(r.a.b, '1');
  });

  it('resolves namespace prefixes to local names and records @ns', () => {
    const xml =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Body><Ping>1</Ping></soapenv:Body></soapenv:Envelope>';
    const r: any = xmlParser(xml);
    assert.equal(r.Envelope['@ns'], 'http://schemas.xmlsoap.org/soap/envelope/');
    assert.equal(r.Envelope.Body.Ping, '1');
  });

  it('different prefixes bound to the same URI parse identically', () => {
    const a: any = xmlParser('<s:E xmlns:s="urn:x"><s:B><v>1</v></s:B></s:E>');
    const b: any = xmlParser('<t:E xmlns:t="urn:x"><t:B><v>1</v></t:B></t:E>');
    assert.deepEqual(a, b);
  });

  it('inherits the default namespace', () => {
    const r: any = xmlParser('<Document xmlns="urn:iso:std:iso:20022"><Hdr><Id>1</Id></Hdr></Document>');
    assert.equal(r.Document['@ns'], 'urn:iso:std:iso:20022');
    assert.equal(r.Document.Hdr['@ns'], 'urn:iso:std:iso:20022');
  });

  it('keeps xmlns declarations out of @attrs', () => {
    const r: any = xmlParser('<a xmlns:p="urn:p" id="1"><b>x</b></a>');
    assert.deepEqual(r.a['@attrs'], { id: '1' });
  });

  it('throws on a mismatched closing tag', () => {
    assert.throws(() => xmlParser('<a><b>1</c></a>'));
  });

  it('throws on unterminated CDATA', () => {
    assert.throws(() => xmlParser('<a><![CDATA[oops</a>'));
  });

  it(
    'throws on a missing closing tag',
    { todo: 'BUG: parser stops at end of input and accepts unclosed elements' },
    () => {
      assert.throws(() => xmlParser('<a><b>1</b>'));
    },
  );

  it(
    'leaves entity-like text inside CDATA untouched',
    { todo: 'BUG: decodeEntities runs after CDATA is unwrapped, so &lt; inside CDATA becomes <' },
    () => {
      const r: any = xmlParser('<a><b><![CDATA[&lt;tag&gt;]]></b></a>');
      assert.equal(r.a.b, '&lt;tag&gt;');
    },
  );

  it(
    'does not let a <__proto__> element change an object prototype',
    { todo: 'BUG: JSON bodies strip __proto__, XML bodies do not; nested fields become inherited props' },
    () => {
      const r: any = xmlParser('<a><__proto__><isAdmin>true</isAdmin></__proto__></a>');
      assert.equal(Object.getPrototypeOf(r.a), Object.prototype);
      assert.equal(r.a.isAdmin, undefined);
    },
  );
});
