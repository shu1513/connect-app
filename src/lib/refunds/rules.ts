/**
 * Who may open the quality record of a call. A plain rule with no database,
 * used by the server before it sends anything: hiding the record on the page
 * would not be enough.
 */
export function recordVisibleTo(input: {
  /** The person's part in the call. "admin" is the founder looking at a call they were not in. */
  role: "host" | "customer" | "admin";
  /** A full admin login, whatever the person's part in the call. */
  founder: boolean;
  /** The reason saved with the call's refund request, or null when there is no request. */
  requestReason: string | null;
  /** Only meaningful without a request: this person is the customer and is still inside their time to ask. */
  canStillAsk: boolean;
}): boolean {
  // Without a request: only the customer's own look before asking.
  if (input.requestReason === null) return input.role === "customer" && input.canStillAsk;
  // The founder, for any call that has a request.
  if (input.founder) return true;
  // The two people of the call, only when the reason given is the connection.
  return input.requestReason === "connection" && (input.role === "host" || input.role === "customer");
}
