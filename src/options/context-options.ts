export type ContextOptions = {
  allowUnknownFields?: boolean;
  isHidden?: boolean;
  openApiDoc?: {
    description?: string;
    operationId: string;
    tags?: string[];
  };
};
