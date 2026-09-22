/** An HTTP boundary error whose message is safe to return to a client. */
export default class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
