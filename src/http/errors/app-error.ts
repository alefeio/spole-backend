export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown[];

  constructor(params: { status: number; code: string; message: string; details?: unknown[] }) {
    super(params.message);
    this.name = "AppError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}
