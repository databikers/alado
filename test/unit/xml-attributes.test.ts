import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { xmlParser } from '../../src/helpers/parser/xml-parser';

function elapsed(fn: () => unknown): number {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

describe('xmlParser attributes', () => {
  it('reads a long run of name characters without "=" in linear time', () => {
    // 3.5.12 needed ~8 s for this 60 KB tag (quadratic), ~40 min for 1 MB
    const ms = elapsed(() => xmlParser('<a ' + 'x'.repeat(60000) + '/>'));
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  it('stays linear when such a run is followed by real attributes', () => {
    let r: any;
    const ms = elapsed(() => (r = xmlParser('<a ' + 'x:'.repeat(30000) + ' id="1" b=\'2\'/>')));
    assert.ok(ms < 500, `took ${ms} ms`);
    assert.deepEqual(r.a['@attrs'], { id: '1', b: '2' });
  });

  it('keeps the attribute rules', () => {
    const r: any = xmlParser(
      '<e a="1" b = \'2\' c="x&amp;y" __proto__="p" constructor="c" f.g-h:i="6" 7j="7" d="unterminated e=\'5\'/>',
    );
    // d has no closing quote, so it is skipped and scanning resumes inside it (as before)
    assert.deepEqual(r.e['@attrs'], { a: '1', b: '2', c: 'x&y', 'f.g-h:i': '6', j: '7', e: '5' });
  });
});
