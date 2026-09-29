export class InvalidSourceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceDataError";
  }
}
