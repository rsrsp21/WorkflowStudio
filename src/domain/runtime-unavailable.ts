export class RuntimeUnavailableError extends Error {
  readonly code = 'RUNTIME_UNAVAILABLE';
  constructor(message = 'Waiting for the paired local runtime to reconnect.') {
    super(message);
    this.name = 'RuntimeUnavailableError';
  }
}

export function isRuntimeUnavailable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'RUNTIME_UNAVAILABLE';
}
