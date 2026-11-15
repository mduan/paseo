export class AntigravityError extends Error {
  constructor(
    message: string,
    readonly code = "ANTIGRAVITY_ERROR",
  ) {
    super(message);
    this.name = "AntigravityError";
  }
}

export function diagnostic(message: string): string {
  if (/auth|sign.in|log.in/i.test(message)) {
    return "Antigravity authentication failed. Run `agy` and sign in, then retry.";
  }
  return message;
}
