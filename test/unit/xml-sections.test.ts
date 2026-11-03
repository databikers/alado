import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { xmlParser } from '../../src/helpers/parser/xml-parser';

function elapsed(fn: () => unknown): number {
  const started = Date.now();
  try {
    fn();
  } catch {
    // only the time matters here
  }
  return Date.now() - started;
}

describe('xmlParser comments and CDATA', () => {
  it('handles many unclosed comments in linear time', () => {
    // 3.5.0 spent ~37 s on 800 KB of this
    const ms = elapsed(() => xmlParser('<a>' + '<!--'.repeat(200000) + '</a>'));
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  it('handles many unclosed CDATA openings in an attribute in linear time', () => {
    const ms = elapsed(() => xmlParser('<a x="' + '<![CDATA['.repeat(100000) + '"/>'));
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  it('removes every comment, including adjacent and multi-line ones', () => {
    const r: any = xmlParser('<a><!-- one --><b>1</b><!--two--><!--\n three \n--><c>2</c></a>');
    assert.equal(r.a.b, '1');
    assert.equal(r.a.c, '2');
  });

  it('matches the old rules for odd comment endings', () => {
    // "<!-->" and "<!--->" do not close a comment: the next "-->" does
    const r: any = xmlParser('<a><!-->x<!--->y--><b>1</b></a>');
    assert.equal(r.a.b, '1');
    assert.equal(Object.keys(r.a).includes('x'), false);
  });

  it('still rejects an unterminated comment', () => {
    assert.throws(() => xmlParser('<a><!-- never closed <b>1</b></a>'));
  });
});
