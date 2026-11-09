export type HttpDecoratorOptions = {
  appId?: string;
  title?: string;
  description?: string;
  isHidden?: boolean | undefined;
  tags?: string[];
  // read the request body although the route declares no body or files fields (a webhook that checks
  // a signature over request.rawBody). Without it, such a route never reads the body
  rawBody?: boolean;
};
