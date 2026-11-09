export type OpenApiDocContract = {
  description?: string;
  operationId: string;
  tags?: string[];
};

export type HiddenRouteContextOptions = {
  allowUnknownFields?: boolean;
  // read the request body although no body or files field is declared: request.rawBody is set
  rawBody?: boolean;
  isHidden: true;
  openApiDoc?: never;
};

export type OpenRouteContextOptions = {
  allowUnknownFields?: boolean;
  // read the request body although no body or files field is declared: request.rawBody is set
  rawBody?: boolean;
  isHidden?: false | undefined;
  openApiDoc: OpenApiDocContract;
};

export type ContextOptions = HiddenRouteContextOptions | OpenRouteContextOptions;
