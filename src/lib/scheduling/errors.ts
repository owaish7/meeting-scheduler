/**
 * Errors caused by bad input, as opposed to bugs.
 *
 * The API layer needs to tell these apart. A bad time zone or a backwards date
 * range is the caller's mistake and should come back as a 400 with a message
 * they can act on. Anything else is our mistake and should be a 500 with the
 * detail kept in the logs.
 *
 * Without a distinct type the two look identical at the boundary, and the safe
 * default is to treat everything as a 500 - which turns "you sent an invalid
 * time zone" into "something went wrong", and hides a fixable problem.
 */
export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingError";
  }
}
