export function setProperty (ctx: any, key: string, value: any) {
  let target = ctx;
  const keys = key.split('.');
  let isArray = false;
  for ( let i = 0; i < keys.length; i++ ) {
    let check: any = keys[ i ].match(/\[(.*)\]/);
    if ( check ) {
      keys[ i ] = keys[ i ].replace( check[0], '' );
      check = check[ 1 ].split( '][' ).length > 1 ? check[ 1 ].split( '][' ) : check;
      if ( ! target[keys[i]] ) {
        target[keys[i]] = check[1] && check[1].match(/^\d+$/) ? []: {};
        isArray = Boolean(check[1] && check[1].match(/^\d+$/));
      }
      target = target[ keys[i] ];
      check = check[ 1 ].split( '][' );
      for ( let j = 0; j < check.length; j++ ) {
        if ( !isArray ) {
          target = target [ check[ j ] ];
        }
      }
      if ( i === keys.length - 1 ) {
        if ( isArray ) {
          target.push(value)
        } else {
          target = value;
        }
      }
    } else {
      if ( i < keys.length - 1 ) {
        target[ keys[ i ] ] = target[ keys[ i ] ] || {};
        target = target[ keys[ i ] ];
      } else {
        target ? target[ keys[ i ] ] = value : target = value;
      }
    }
  }
}
