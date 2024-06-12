export function getProperty(ctx: any, key: string): any {
  if(!key) {
    return ctx;
  }
  let target = ctx;
  const keys = key.split( '.' );
  let i = 0;
  while( i < keys.length ) {
    let check: any = keys[ i ].match( /\[(.*)\]/ );
    if ( check ) {
      keys[ i ] = keys[ i ].replace( check[ 0 ], '');
      check = check[ 1 ].split( '][' );
      target = target[ keys[ i ] ];
      let j = 0;
      while (  j < check.length ) {
        target = target [ check[ j ] ];
        j++
      }
      if ( i === keys.length - 1 ) {
        return target;
      }
    } else {
      if ( i < keys.length - 1 ) {
        target = target[ keys[ i ] ] !== undefined ? target[ keys[ i ] ] : undefined;
      } else {
        return target  ? target[ keys[ i ] ] : undefined;
      }
    }
    i++
  }
}
