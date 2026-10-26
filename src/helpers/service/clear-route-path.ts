import { multiSlashRegExp, startRouteRegexp, trimRouteRegexp } from '@const';

const SLASH: number = 47;

export function clearRoutePath(route: string) {
  if (route.charCodeAt(0) === SLASH && route.charCodeAt(route.length - 1) !== SLASH && route.indexOf('//') === -1) {
    return route;
  }
  if (!startRouteRegexp.test(route)) {
    route = `/${route}`;
  }
  route = route.replace(multiSlashRegExp, '/');
  if (trimRouteRegexp.test(route)) {
    route = route.replace(trimRouteRegexp, '');
  }
  return route;
}
