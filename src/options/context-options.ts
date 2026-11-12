export type OpenApiDocContract = {
  description?: string;
  operationId: string;
  tags?: string[];
};

export type HiddenRouteContextOptions = {
  allowUnknownFields?: boolean;
  // read the request body although no body or files field is declared: request.rawBody is set
  rawBody?: boolean;
  // largest request body this route reads, in bytes; replaces the server's maxBodySizeBytes for it
  // (an upload route can take more than the JSON routes). 0 removes the limit
  maxBodySizeBytes?: number;
  isHidden: true;
  openApiDoc?: never;
};

export type OpenRouteContextOptions = {
  allowUnknownFields?: boolean;
  // read the request body although no body or files field is declared: request.rawBody is set
  rawBody?: boolean;
  // largest request body this route reads, in bytes; replaces the server's maxBodySizeBytes for it
  // (an upload route can take more than the JSON routes). 0 removes the limit
  maxBodySizeBytes?: number;
  isHidden?: false | undefined;
  openApiDoc: OpenApiDocContract;
};

export type ContextOptions = HiddenRouteContextOptions | OpenRouteContextOptions;
