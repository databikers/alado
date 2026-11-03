import { AladoServerError, Context } from '@dto';
import { matchesFileSignature, uploadedFileHeads } from './file-signature';

export function validateRequestFiles(context: Context<any>, request: any): AladoServerError | undefined {
  const { files } = context.request;
  if (files) {
    for (const file in files) {
      const { required, mimetypes, maxSize, requiredError, maxSizeError, mimetypeError, verifyContent } = files[file];
      if (required && (!request.files || !request.files[file])) {
        return requiredError;
      }
      const uploaded = request.files?.[file];
      if (!uploaded) {
        if (required) {
          return requiredError;
        }
        continue;
      }
      const { size, mimetype } = uploaded;
      if (!mimetypes.includes(mimetype)) {
        return mimetypeError;
      }
      if (size > maxSize) {
        return maxSizeError;
      }
      // the declared type is the client's word; the first bytes have to agree with it
      if (verifyContent !== false && !matchesFileSignature(mimetype, uploadedFileHeads.get(uploaded))) {
        return mimetypeError;
      }
    }
    if (!context.options?.allowUnknownFields) {
      for (const f in request.files) {
        if (!files[f]) {
          delete request.files[f];
        }
      }
    }
  } else {
    request.files = {};
  }
}
