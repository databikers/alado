export type OpenApiDocContract = {
  description?: string;
  operationId: string;
  tags?: string[];
};

export type HiddenRouteContextOptions = {
  allowUnknownFields?: boolean;
  isHidden: true;
  openApiDoc?: never;
};

export type OpenRouteContextOptions = {
  allowUnknownFields?: boolean;
  isHidden?: false | undefined;
  openApiDoc: OpenApiDocContract;
};

export type ContextOptions = HiddenRouteContextOptions | OpenRouteContextOptions;
