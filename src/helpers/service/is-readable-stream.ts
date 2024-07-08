import { Readable } from 'stream';
export function isReadableStream(stream: Readable) {
  return (
    stream !== null &&
    typeof stream === 'object' &&
    typeof stream.pipe === 'function' &&
    typeof stream.read === 'function' &&
    typeof stream.readable === 'boolean' &&
    typeof stream.readableObjectMode === 'boolean' &&
    typeof stream.destroy === 'function' &&
    typeof stream.destroyed === 'boolean'
  );
}
