/**
 * Stub for the `server-only` package under Vitest.
 *
 * `server-only` exists to make the Next bundler fail a build that imports a
 * server module into the client. It has no runtime behaviour, so tests alias
 * it here rather than being unable to exercise the server layer at all.
 */
export {};
