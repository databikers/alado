/**
 * How request bodies are turned into `request.body` and `request.files`.
 */
export type ParsingOptions = {
  /**
   * Several multipart files under one field name (`<input type="file" multiple>`, or `docs[]`):
   * - 'last' (default): `request.files[name]` is the last of them, as before;
   * - 'array': `request.files[name]` is an array of every file, in order (also for one file sent
   *   as `name[]`), and each of them is checked against the field's rules.
   */
  repeatedFiles?: 'last' | 'array';
};
