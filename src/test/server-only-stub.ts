/**
 * Stands in for the `server-only` package under vitest.
 *
 * That package exists to make the bundler fail if server code is pulled into a
 * client bundle. Under test there is no bundle and no client, so importing the
 * real one just throws.
 */
export {};
