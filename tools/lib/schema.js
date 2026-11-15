// The JSON Schema interpreter lives in the package (src/schema.ts) so the
// repository checks and every host's validation run the same code. Node 24
// strips the types when it imports it.
export * from '../../src/schema.ts';
