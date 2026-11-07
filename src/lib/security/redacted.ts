const REDACTED = "[redacted]";

/**
 * Holds a secret (client secret, access token) so that accidental logging,
 * string interpolation, JSON serialization or util.inspect shows
 * "[redacted]". Code that genuinely needs the value calls reveal().
 */
export class Redacted {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
