/** Explicit statement rejections roll back the write; transport errors and 5xx responses do not. */
export function hasDefinitivePostgresWriteRejection(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && typeof error.code === "string"
    && ["42501", "23505", "23502", "23503", "23514", "22023", "22P02", "P0001", "P0002"].includes(error.code);
}
