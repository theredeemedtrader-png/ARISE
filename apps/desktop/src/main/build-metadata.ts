declare const __ARISE_BUILD_COMMIT__: string;
declare const __ARISE_BUILD_DATE__: string;

export const BUILD_COMMIT = typeof __ARISE_BUILD_COMMIT__ === 'string'
  ? __ARISE_BUILD_COMMIT__
  : 'development';
export const BUILD_DATE = typeof __ARISE_BUILD_DATE__ === 'string'
  ? __ARISE_BUILD_DATE__
  : 'development';
