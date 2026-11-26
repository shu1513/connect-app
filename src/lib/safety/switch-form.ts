/**
 * Reading the founder's "Stop switches" form (src/app/admin/reports). Kept apart from the action so
 * that it can be tested: what a form does NOT hold matters here.
 *
 * An unticked box is not sent at all, so "not sent" normally means "off". The box for messages
 * between hosts and customers was added later (plans/49-messaging.md), and a page that was opened
 * before that has no such box: saved from there, "not sent" must not switch messages back on
 * after the founder stopped them. So the form says by a hidden field that it has the box, and
 * without that field the switch for messages is left as it is.
 */
export type StopSwitches = { requestsOff: boolean; joiningOff: boolean; conversationsOff?: boolean };

export function stopSwitchesFrom(formData: FormData): { values: StopSwitches; detail: string } {
  const values: StopSwitches = { requestsOff: formData.get("requestsOff") === "on", joiningOff: formData.get("joiningOff") === "on" };
  let detail = `new requests ${values.requestsOff ? "off" : "on"}; joining calls ${values.joiningOff ? "off" : "on"}`;
  if (formData.get("hasConversationsOff") === "1") {
    values.conversationsOff = formData.get("conversationsOff") === "on";
    detail += `; messages between hosts and customers ${values.conversationsOff ? "off" : "on"}`;
  }
  return { values, detail };
}
