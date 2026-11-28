import { afterEach, describe, expect, it, vi } from "vitest";

// The rules only: the half of the file that asks the database is covered by scripts/agreements-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { AUDIENCE, comingAtSignUp, comingVersions, dayInWords, failureIsOurs, noticeDeadline, noticeEmail, noticeKeyStart, readNoticeKey, wasRefused } from "./notices";
import { DOCUMENT_NAMES, DOCUMENTS, type DocumentName, type DocumentVersion } from "./versions";

const now = new Date("2027-03-01T12:00:00.000Z");
const added: [DocumentName, DocumentVersion][] = [];
/** Adds a made-up version for one test; taken out again after it. */
function add(name: DocumentName, version: Partial<DocumentVersion> & { version: string; effectiveFrom: string }): DocumentVersion {
  const whole: DocumentVersion = { addedOn: "2027-01-01", draft: false, summary: "Section 4 says more about refunds.", ...version };
  DOCUMENTS[name].versions.push(whole);
  added.push([name, whole]);
  return whole;
}
afterEach(() => {
  for (const [name, version] of added.splice(0)) DOCUMENTS[name].versions.splice(DOCUMENTS[name].versions.indexOf(version), 1);
});

describe("who is told about a coming version", () => {
  it("names an audience for every document, and nobody for the notice shown at each identity check", () => {
    expect(Object.keys(AUDIENCE).sort()).toEqual([...DOCUMENT_NAMES].sort());
    expect(AUDIENCE["identity-check-notice"]).toBeNull();
    expect(AUDIENCE["host-agreement"]).toBe("hosts");
    expect(AUDIENCE["privacy-policy"]).toBe("everyone");
  });

  it("finds nothing while nothing is coming", () => {
    expect(comingVersions(now)).toEqual([]);
  });

  it("finds every coming version of a document, not only the next one, each with its own 30 days", () => {
    add("payment-terms", { version: "2027-02-01", effectiveFrom: "2027-02-10" });
    const first = add("payment-terms", { version: "2027-03-01", effectiveFrom: "2027-06-01" });
    const second = add("payment-terms", { version: "2027-03-02", effectiveFrom: "2027-06-10" });
    expect(comingVersions(now).map((c) => [c.version, c.owed])).toEqual([[first, true], [second, true]]);
  });

  it("does not take an urgency that says nothing for a reason", () => {
    add("payment-terms", { version: "2027-02-01", effectiveFrom: "2027-02-10" });
    add("payment-terms", { version: "2027-03-01", effectiveFrom: "2027-03-08", urgent: "   " });
    expect(comingVersions(now).map((c) => c.owed)).toEqual([true]);
  });

  it("finds a coming version, and not one whose day has come", () => {
    add("payment-terms", { version: "2027-02-01", effectiveFrom: "2027-02-10" });
    const coming = add("payment-terms", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    expect(comingVersions(now)).toEqual([{ name: "payment-terms", version: coming, audience: "everyone", owed: true }]);
    expect(comingVersions(new Date("2027-04-15T00:00:00.000Z"))).toEqual([]);
  });

  it("does not announce a new Identity Check Notice", () => {
    add("identity-check-notice", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    expect(comingVersions(now)).toEqual([]);
  });

  it("owes no 30 days after a draft, nor for a version that says why it is urgent", () => {
    // The first published version follows the draft of 2026-11-20.
    add("terms-of-service", { version: "2027-03-01", effectiveFrom: "2027-03-05" });
    expect(comingVersions(now).map((c) => c.owed)).toEqual([false]);
    add("host-agreement", { version: "2027-01-05", effectiveFrom: "2027-01-10" });
    add("host-agreement", { version: "2027-03-01", effectiveFrom: "2027-03-08", urgent: "A court order." });
    expect(comingVersions(now).find((c) => c.name === "host-agreement")).toMatchObject({ audience: "hosts", owed: false });
  });
});

describe("the email", () => {
  it("has the last moment for it 30 days before the day", () => {
    expect(noticeDeadline({ version: "v", effectiveFrom: "2027-04-15", addedOn: "2027-03-01", draft: false, summary: "" }).toISOString()).toBe("2027-03-16T00:00:00.000Z");
  });

  it("writes a day in words", () => {
    expect(dayInWords("2027-04-05")).toBe("5 April 2027");
  });

  it("has a key that holds the document, the version, the day and the person, and reads it back", () => {
    const version = add("payment-terms", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    const key = `${noticeKeyStart("payment-terms", version)}person-1`;
    expect(key).toBe("agreement-notice:payment-terms:2027-03-01:2027-04-15:person-1");
    expect(readNoticeKey(key)).toEqual({ name: "payment-terms", version: "2027-03-01", effectiveFrom: "2027-04-15", userId: "person-1" });
    expect(readNoticeKey("reminder:1:2:3")).toBeNull();
  });

  const held = { version: "2026-11-20" };

  it("says what changes, when, where to read both versions, and what the person has to do", () => {
    const version = add("payment-terms", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    const email = noticeEmail({ name: "payment-terms", version }, { name: "Ann" }, "https://connect.example", held);
    expect(email.subject).toBe("Our Payment Terms will change on 15 April 2027");
    expect(email.text).toContain("Hi Ann,");
    expect(email.text).toContain("takes effect on 15 April 2027, at 00:00 UTC.");
    expect(email.text).toContain("Section 4 says more about refunds.");
    expect(email.text).toContain("https://connect.example/payment-terms?version=2027-03-01");
    expect(email.text).toContain("The version in effect today:");
    // The version held today is linked by its own name, so the link still shows that text after the change.
    expect(email.text).toContain("https://connect.example/payment-terms?version=2026-11-20\n");
    expect(email.text).toContain("From 15 April 2027 we ask you to accept the new version the next time you use Connect.");
    expect(email.text).toContain("ask us to close your account before 15 April 2027");
    expect(email.text).toContain("stay under the version that applied when they were agreed");
    expect(email.text).not.toContain("section 20.10");
  });

  it("names the way to reject a change to how disputes are settled, for the Terms only", () => {
    const version = add("terms-of-service", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    expect(noticeEmail({ name: "terms-of-service", version }, { name: "Ann" }, "https://c.example", held).text).toContain("section 20.10 says how you can reject that change");
  });

  it("tells a host where she will be asked and how to end hosting, and asks nothing for a document that is told and not accepted", () => {
    const host = add("host-agreement", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    const hosting = noticeEmail({ name: "host-agreement", version: host }, { name: "Bo" }, "https://c.example", held).text;
    expect(hosting).toContain("your Hosting page asks you to accept the new version");
    expect(hosting).toContain("by closing your host page before 15 April 2027");
    expect(hosting).toContain("does not apply to calls already booked or to membership months already begun");
    expect(hosting).not.toContain("close your account");
    const privacy = add("privacy-policy", { version: "2027-03-01", effectiveFrom: "2027-04-15" });
    const told = noticeEmail({ name: "privacy-policy", version: privacy }, { name: "Bo" }, "https://c.example", held).text;
    expect(told).toContain("You do not need to do anything.");
    expect(told).not.toContain("accept the new version");
  });
});

describe("a notice that failed", () => {
  it("is ours to mend unless the address bounces or the email was no longer true", () => {
    expect(failureIsOurs("422 validation_error")).toBe(true);
    expect(failureIsOurs(null)).toBe(true);
    expect(failureIsOurs("address not written to: bounced")).toBe(false);
    expect(failureIsOurs("no longer wanted: the account is closed")).toBe(false);
  });

  it("is sent again only when the sending service was asked once and refused outright", () => {
    expect(wasRefused("422 validation_error The address is not valid", 1)).toBe(true);
    // After several tries an earlier one may have been accepted with its answer lost.
    expect(wasRefused("422 validation_error", 2)).toBe(false);
    // "An earlier request with this key is still under way."
    expect(wasRefused("409 concurrent_idempotent_requests", 1)).toBe(false);
    expect(wasRefused("500 internal_server_error", 1)).toBe(false);
    expect(wasRefused("an earlier try is more than a day old and its outcome is unknown; not repeated. Check at the sending service", 1)).toBe(false);
    expect(wasRefused("gave up after 6 tries; the last one did not finish", 6)).toBe(false);
    expect(wasRefused(null, 0)).toBe(false);
  });
});

describe("what the last step of signing up says about a coming version", () => {
  it("says nothing while nothing is coming", () => {
    expect(comingAtSignUp(now)).toEqual([]);
  });

  it("a document the step accepts: the fixed sentence, the summary for the website, the link, and that it is asked for on its day", () => {
    add("payment-terms", { version: "2027-02-20", effectiveFrom: "2027-04-12", summary: "Section 4 says more about refunds." });
    expect(comingAtSignUp(now)).toEqual([
      {
        name: "payment-terms",
        title: "Payment Terms",
        version: "2027-02-20",
        effectiveFrom: "2027-04-12",
        accepted: true,
        href: "/payment-terms?version=2027-02-20",
        applies: "From 12 April 2027 a new version of the Payment Terms applies.",
        summary: "Section 4 says more about refunds.",
        read: "Read it",
        thenAccept: "You will be asked to accept it then.",
      },
    ]);
  });

  it("a document a person is only told about is said too, and nobody is asked to accept it; one for hosts alone is not said here", () => {
    add("privacy-policy", { version: "2027-02-21", effectiveFrom: "2027-04-13" });
    add("host-agreement", { version: "2027-02-22", effectiveFrom: "2027-04-14" });
    const said = comingAtSignUp(now);
    expect(said.map((one) => [one.name, one.accepted, one.thenAccept])).toEqual([["privacy-policy", false, null]]);
    // The fixed sentence never carries what the version changes: that is the summary's, and the summary is free text.
    expect(said[0].applies).toBe("From 13 April 2027 a new version of the Privacy Policy applies.");
  });
});
