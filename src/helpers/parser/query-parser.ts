export function queryParser(queryString: string) {
  const query: Record<string, any> = {};
  if (queryString) {
    decodeURIComponent(queryString).split('&').forEach((part) => {
      const [key, value,] = part.split('=');
      if (key && value) {
        const transformedValue: string = decodeURIComponent(value).replace(/[\n\s]/g, '');
        if (/\w+\[\]$/.test(key)) {
          const k: string = key.replace(/\[\]$/, '');
          query[k] = query[k] || [];
          query[k].push(transformedValue);
        } else if (key in query) {
          if (!Array.isArray(query[key])) {
            query[key] = [query[key]];
          }
          query[key].push(transformedValue)
        } else {
          query[key] = transformedValue;
        }
      }
    });
  }
  return query;
}
