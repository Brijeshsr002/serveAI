export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const forbidden = (message = "You do not have permission to do this") =>
  new ApiError(403, "FORBIDDEN", message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
