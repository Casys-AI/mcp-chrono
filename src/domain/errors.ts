export class ChronoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChronoError";
  }
}
export const errorResult = (
  error: unknown,
): { code: string; message: string; details?: Record<string, unknown> } => {
  if (error instanceof ChronoError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return { code: "internal_error", message: "An internal provider error occurred." };
};
