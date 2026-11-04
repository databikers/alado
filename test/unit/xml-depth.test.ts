import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { resolve as resolvePath } from 'path';
import { MAX_XML_DEPTH, xmlParser } from '../../src/helpers/parser/xml-parser';

const nested = (depth: number): string => '<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth);

function uniqueNested(depth: number): string {
  let xml = '';
  for (let i = 0; i < depth; i++) {
    xml += `<t${i}>`;
  }
  for (let i = depth - 1; i >= 0; i--) {
    xml += `</t${i}>`;
  }
  return xml;
}

describe('xmlParser nesting depth', () => {
  it(`parses ${MAX_XML_DEPTH} nested elements`, () => {
    let value: any = xmlParser(nested(MAX_XML_DEPTH));
    for (let i = 0; i < MAX_XML_DEPTH; i++) {
      value = value.a;
    }
    assert.equal(value, 'x');
  });

  it('rejects deeper nesting with its own error instead of a stack overflow', () => {
    for (const depth of [
      MAX_XML_DEPTH + 1,
      100000,
    ]) {
      assert.throws(
        () => xmlParser(nested(depth)),
        (e: Error) => !(e instanceof RangeError) && /nested deeper than/.test(e.message),
      );
    }
  });

  it('still matches closing tags with whitespace and rejects a mismatched one', () => {
    assert.deepEqual(xmlParser('<root><ab>1</ab ></root   >'), { root: { ab: '1', '@ns': null } });
    assert.throws(() => xmlParser('<a>1</ab>'), /Malformed XML|Unclosed element/);
  });

  // 3.5.4 aborted the whole process (SIGABRT, "RegExpCompiler Allocation failed") on ~43 KB of
  // nested elements with distinct names, so this runs in a child process
  it('does not abort the process on deep nesting with distinct tag names', () => {
    const script = `
      const { xmlParser } = require(${JSON.stringify(resolvePath(__dirname, '../../src/helpers/parser/xml-parser'))});
      let xml = '';
      for (let i = 0; i < 20000; i++) xml += '<t' + i + '>';
      for (let i = 19999; i >= 0; i--) xml += '</t' + i + '>';
      try { xmlParser(xml); process.stdout.write('PARSED'); } catch (e) { process.stdout.write('THREW'); }
    `;
    const r = spawnSync(
      process.execPath,
      [
        '-e',
        script,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    assert.equal(r.signal, null, r.stderr.split('\n').slice(0, 3).join('\n'));
    assert.equal(r.stdout, 'THREW');
  });

  it('parses distinct tag names up to the limit', () => {
    let value: any = xmlParser(uniqueNested(MAX_XML_DEPTH));
    for (let i = 0; i < MAX_XML_DEPTH - 1; i++) {
      value = value[`t${i}`];
    }
    assert.equal(value[`t${MAX_XML_DEPTH - 1}`], '');
  });
});
