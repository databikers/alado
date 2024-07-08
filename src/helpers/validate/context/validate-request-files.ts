import { Context } from '@dto';

export function validateRequestFiles(context: Context<any>, request: any) {
  const { files } = context.request;
  if (files) {
    for (const file in files) {
      const { required, mimetypes, maxSize, requiredError, maxSizeError, mimetypeError } = files[file];
      if (required && (!request.files || !request.files[file])) {
        return requiredError;
      }
      const { size, mimetype } = request.files[file];
      if (!mimetypes.includes(mimetype)) {
        return mimetypeError;
      }
      if (size > maxSize) {
        return maxSizeError;
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
