export interface ContextOptions {
  allowUnknownFields?: boolean;
  openApiDoc?: {
    description?: string;
    operationId: string;
    tags?: string[];
  }
}
