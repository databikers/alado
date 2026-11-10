/**
 * How request bodies are turned into `request.body` and `request.files`.
 */
export type ParsingOptions = {
  /**
   * How many files one multipart field name may carry in a request. Default 1: a second file under
   * the same name (`<input type="file" multiple>`, `docs[]` sent twice) refuses the request with
   * 400. Raise it to accept several files per field (then `repeatedFiles` says how they are given);
   * 0 means no limit. Text fields are not counted.
   */
  maxFilesPerField?: number;
  /**
   * Several multipart files under one field name, when `maxFilesPerField` allows them:
   * - 'last' (default): `request.files[name]` is the last of them, as before;
   * - 'array': `request.files[name]` is an array of every file, in order (also for one file sent
   *   as `name[]`), and each of them is checked against the field's rules.
   */
  repeatedFiles?: 'last' | 'array';
};
