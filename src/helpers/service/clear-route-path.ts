import { multiSlashRegExp, startRouteRegexp, trimRouteRegexp } from '@const';

export function clearRoutePath(route: string) {
  if (!startRouteRegexp.test(route)) {
    route = `/${route}`;
  }
  route = route.replace(multiSlashRegExp, '/');
  if (trimRouteRegexp.test(route)) {
    route = route.replace(trimRouteRegexp, '');
  }
  return route;
}
