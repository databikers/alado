/**
 * Leading bytes ("magic numbers") of formats that have a fixed signature. The MIME type of an upload
 * comes from the client, so for these types the content has to agree with it as well.
 * Types without a reliable signature (text, CSV, SVG, JSON...) are not checked.
 */
const ascii = (text: string): number[] => Array.from(text, (c: string) => c.charCodeAt(0));

const startsWith = (head: Buffer, bytes: number[], offset: number = 0): boolean =>
  head.length >= offset + bytes.length && bytes.every((byte: number, i: number) => head[offset + i] === byte);

const signatures: Record<string, (head: Buffer) => boolean> = {
  'image/png': (head) =>
    startsWith(
      head,
      [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ],
    ),
  'image/jpeg': (head) =>
    startsWith(
      head,
      [
        0xff,
        0xd8,
        0xff,
      ],
    ),
  'image/gif': (head) => startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a')),
  'image/webp': (head) => startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8),
  'application/pdf': (head) => startsWith(head, ascii('%PDF-')),
  'application/zip': (head) =>
    startsWith(
      head,
      [
        0x50,
        0x4b,
        0x03,
        0x04,
      ],
    ) ||
    startsWith(
      head,
      [
        0x50,
        0x4b,
        0x05,
        0x06,
      ],
    ),
};

// bytes needed to check every signature above
export const FILE_SIGNATURE_BYTES: number = 16;

// first bytes of each uploaded file, kept out of the public file object
export const uploadedFileHeads: WeakMap<object, Buffer> = new WeakMap();

/** true when the type has no known signature, or the content starts with it */
export function matchesFileSignature(mimetype: string, head: Buffer | undefined): boolean {
  const check = signatures[mimetype.toLowerCase()];
  return !check || (head !== undefined && check(head));
}

export function hasFileSignature(mimetype: string): boolean {
  return Boolean(signatures[mimetype.toLowerCase()]);
}
