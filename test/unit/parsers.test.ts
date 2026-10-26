import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryParser, clearRoutePath, getProperty, setProperty } from '../../src/helpers';
import { xmlParser } from '../../src/helpers/parser/xml-parser';
import { bodyParser } from '../../src/helpers/parser/body-parser';
import { Readable } from 'stream';

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

  it('keeps an encoded & inside a value', () => {
    assert.deepEqual(queryParser('q=tom%26jerry&x=1'), { q: 'tom&jerry', x: '1' });
  });

  it('keeps = inside a value, encoded or not', () => {
    assert.deepEqual(queryParser('token=abc%3D%3D'), { token: 'abc==' });
    assert.deepEqual(queryParser('token=abc=='), { token: 'abc==' });
  });

  it('keeps spaces inside a value (%20 and +)', () => {
    assert.deepEqual(queryParser('city=New%20York&name=Pablo+L'), { city: 'New York', name: 'Pablo L' });
  });

  it('throws an HTTP-mappable error on malformed encoding, not a generic URIError', () => {
    assert.throws(
      () => queryParser('a=%E0%A4%A'),
      (e: any) => e.statusCode === 400 && /Malformed/.test(e.message),
    );
  });

  it('decodes keys, including encoded [] suffixes', () => {
    assert.deepEqual(queryParser('id%5B%5D=1&id%5B%5D=2&na%6De=x'), {
      id: [
        '1',
        '2',
      ],
      name: 'x',
    });
  });

  it('ignores __proto__ / constructor keys', () => {
    const q = queryParser('__proto__=x&constructor=y&__proto__[]=z&ok=1');
    assert.deepEqual(q, { ok: '1' });
    assert.equal(Object.getPrototypeOf(q), Object.prototype);
  });

  it('turns a key named like an Object.prototype method into a normal value', () => {
    assert.deepEqual(queryParser('toString=a&hasOwnProperty=b'), { toString: 'a', hasOwnProperty: 'b' });
  });
});

describe('getProperty / setProperty', () => {
  it('reads nested dot paths', () => {
    const o = { headers: { authorization: 'Bearer x' } };
    assert.equal(getProperty(o, 'headers.authorization'), 'Bearer x');
  });

  it('returns undefined for a missing last branch', () => {
    assert.equal(getProperty({ auth: {} }, 'auth.user'), undefined);
  });

  it('returns undefined when a middle branch is missing instead of throwing', () => {
    assert.equal(getProperty({}, 'auth.user.id'), undefined);
    assert.equal(getProperty({ auth: null }, 'auth.user.id'), undefined);
    assert.equal(getProperty({}, 'list[0].id'), undefined);
    assert.equal(getProperty({ list: [] }, 'list[0].id'), undefined);
    assert.equal(getProperty({ m: {} }, 'm[a][b]'), undefined);
  });

  it('still returns falsy leaf values', () => {
    assert.equal(getProperty({ a: { b: 0 } }, 'a.b'), 0);
    assert.equal(getProperty({ a: { b: false } }, 'a.b'), false);
    assert.equal(getProperty({ a: { b: '' } }, 'a.b'), '');
  });

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

  it('throws on a missing closing tag', () => {
    assert.throws(() => xmlParser('<a><b>1</b>'), /Unclosed element <a>/);
    assert.throws(() => xmlParser('<a><b>1'), /Unclosed element <b>/);
  });

  it('matches closing tags literally (a dot in a name is not a wildcard)', () => {
    assert.deepEqual(xmlParser('<a.b>1</a.b>'), { 'a.b': '1' });
    assert.throws(() => xmlParser('<a.b>1</aXb>'));
  });

  it('leaves entity-like text inside CDATA untouched', () => {
    const r: any = xmlParser('<a><b><![CDATA[&lt;tag&gt; &amp;]]></b></a>');
    assert.equal(r.a.b, '&lt;tag&gt; &amp;');
  });

  it('decodes entities around CDATA but not inside it', () => {
    const r: any = xmlParser('<a><b>x&amp;<![CDATA[&amp;]]>&lt;y</b></a>');
    assert.equal(r.a.b, 'x&&amp;<y');
  });

  it('does not let a <__proto__> element change an object prototype', () => {
    const r: any = xmlParser('<a><__proto__><isAdmin>true</isAdmin></__proto__><b>1</b></a>');
    assert.equal(Object.getPrototypeOf(r.a), Object.prototype);
    assert.equal(r.a.isAdmin, undefined);
    assert.equal(r.a.b, '1');
  });

  it('drops constructor / prototype elements and unsafe attribute names', () => {
    const r: any = xmlParser(
      '<a __proto__="x" ok="1"><constructor>1</constructor><prototype>2</prototype><b>3</b></a>',
    );
    assert.equal(r.a.constructor, Object);
    assert.equal(Object.prototype.hasOwnProperty.call(r.a, 'prototype'), false);
    assert.deepEqual(r.a['@attrs'], { ok: '1' });
    assert.equal(Object.getPrototypeOf(r.a['@attrs']), Object.prototype);
  });

  it('returns {} for a root element named __proto__', () => {
    const r: any = xmlParser('<__proto__><isAdmin>true</isAdmin></__proto__>');
    assert.equal(r.isAdmin, undefined);
    assert.equal(Object.keys(r).length, 0);
  });
});

describe('bodyParser (JSON)', () => {
  const parseJson = async (text: string) => {
    const req: any = Readable.from([Buffer.from(text)]);
    req.headers = { 'content-type': 'application/json' };
    return (await bodyParser(req, {} as any, 0)).body;
  };

  it('parses a plain JSON body', async () => {
    assert.deepEqual(await parseJson('{"a":1,"b":[1,2],"c":{"d":"e"}}'), {
      a: 1,
      b: [
        1,
        2,
      ],
      c: { d: 'e' },
    });
  });

  it('drops __proto__ / constructor / prototype / __defineGetter__ / __defineSetter__ keys at any depth', async () => {
    const body = await parseJson(
      '{"a":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"prototype":1,' +
        '"__defineGetter__":1,"__defineSetter__":2,"nested":{"b":2,"__proto__":{"y":1}}}',
    );
    assert.deepEqual(body, { a: 1, nested: { b: 2 } });
    assert.equal(Object.getPrototypeOf(body), Object.prototype);
    assert.equal(({} as any).polluted, undefined);
  });

  it('keeps string values that merely mention a forbidden key', async () => {
    assert.deepEqual(await parseJson('{"note":"the constructor of __proto__ chains","list":["prototype"]}'), {
      note: 'the constructor of __proto__ chains',
      list: ['prototype'],
    });
  });

  it('rejects malformed JSON with an HTTP-mappable 400', async () => {
    await assert.rejects(parseJson('{"a":'), { statusCode: 400, message: 'Invalid JSON body' });
  });
});
