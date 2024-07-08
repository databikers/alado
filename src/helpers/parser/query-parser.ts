export function queryParser(queryString: string): Record<string, any> {
  const query: any = {};
  if (queryString) {
    queryString.split('&').forEach((s: string) => {
      const [key, value] = s.split('=');
      if (key && value) {
        if (/\w+\[\]$/.test(key)) {
          const k = key.replace(/\[\]$/, '');
          query[k] = query[k] || [];
          query[k].push(value);
        } else {
          query[key] = value;
        }
      }
    });
  }
  return query;
}
