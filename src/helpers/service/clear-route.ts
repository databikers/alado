import { multiSlashRegEx, startRouteRegex, trimRouteRegex } from '@const';

export function clearRoute(route: string) {
  if (!startRouteRegex.test(route)) {
    route = `/${route}`;
  }
  route = route.replace(multiSlashRegEx, '/');
  if (trimRouteRegex.test(route)) {
    route = route.replace(trimRouteRegex, '')
  }
  return route;
}
