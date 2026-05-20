export class YoloopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoloopError";
  }
}

export function fail(message: string): never {
  throw new YoloopError(message);
}
