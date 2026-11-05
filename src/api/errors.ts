export function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
