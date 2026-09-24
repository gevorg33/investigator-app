/**
 * An external model provider failed — unreachable, refused, or answered with something unusable.
 *
 * Its own class so a caller can tell "the provider is down" (a 503 the client can retry) from a
 * bug in this codebase (a 500), without matching on messages. The message carries a status and
 * never a response body, which can echo the request.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
}
