export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    "internal_error",
    500,
    "Die Anfrage konnte nicht verarbeitet werden."
  );
}
