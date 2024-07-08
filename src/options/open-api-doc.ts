export interface OpenApiDocInfo {
  title: string;
  version: string;
  description: string;
}

export interface OpenApiDoc {
  enable: boolean;
  route?: string;
  info?: OpenApiDocInfo;
}
