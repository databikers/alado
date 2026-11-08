import { readdirSync } from 'fs';
import { clearRoutePath } from './clear-route-path';

export const swaggerContentTypes: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  map: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  png: 'image/png',
};

let assetPath: string | undefined;
let fileNames: Set<string> | undefined;

export function swaggerUiAssetPath(): string {
  if (assetPath === undefined) {
    assetPath = require('swagger-ui-dist').absolutePath() as string;
  }
  return assetPath;
}

/** Web assets directly inside swagger-ui-dist: the only files ever served (not package.json, README, LICENSE). */
export function swaggerUiFileNames(): Set<string> {
  if (fileNames === undefined) {
    fileNames = new Set(
      readdirSync(swaggerUiAssetPath(), { withFileTypes: true })
        .filter((entry) => entry.isFile() && swaggerContentTypes[entry.name.slice(entry.name.lastIndexOf('.') + 1)])
        .map((entry) => entry.name),
    );
  }
  return fileNames;
}

/** The OpenAPI document lives under the docs route: "/docs" -> "/docs/swagger.json". */
export function openApiJsonPath(docsRoute: string): string {
  return `${clearRoutePath(docsRoute || '')}/swagger.json`;
}

/**
 * Whether GET on this path (already through clearRoutePath) is answered by the docs: the docs
 * page, the OpenAPI document or a Swagger UI file. A route there could never be reached.
 */
export function isOpenApiPath(path: string, docsRoute: string): boolean {
  const route: string = clearRoutePath(docsRoute || '');
  if (path === route || path === openApiJsonPath(route)) {
    return true;
  }
  return path.startsWith(`${route}/`) && swaggerUiFileNames().has(path.slice(route.length + 1));
}
