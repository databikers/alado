export type OpenApiDocInfo = {
  title: string;
  version: string;
  description: string;
}

export type OpenApiDoc = {
  enable: boolean;
  route?: string;
  info?: OpenApiDocInfo;
}
