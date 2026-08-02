// vitest alias target for "server-only" — the real package throws outside an
// RSC bundler context; tests run in plain node where the guard is meaningless.
export {};
