import { afterEach, describe, expect, it, vi } from "vitest";

// Only the plain rule is tried here: what the app is sent about a coming version, from the list of documents.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { DOCUMENTS, type DocumentVersion } from "@/legal/versions";
import { comingShown } from "./shown";

const now = new Date("2027-03-01T12:00:00.000Z");
const added: DocumentVersion[] = [];
afterEach(() => {
  for (const version of added.splice(0)) DOCUMENTS["payment-terms"].versions.splice(DOCUMENTS["payment-terms"].versions.indexOf(version), 1);
});

describe("what the app's last step of signing up is sent about a coming version", () => {
  it("nothing while nothing is coming", () => {
    expect(comingShown(now)).toEqual([]);
  });

  it("the document, the day, whether it is accepted, fixed words and the link: never the version's own summary", () => {
    // A summary as a person might write it for a version that changes the terms about contributions and tips.
    const version: DocumentVersion = { version: "2027-02-20", effectiveFrom: "2027-04-12", addedOn: "2027-02-20", draft: false, summary: "Monthly contributions to a host's project and tips after a call are now refunded within 14 days." };
    DOCUMENTS["payment-terms"].versions.push(version);
    added.push(version);
    const sent = comingShown(now);
    expect(sent).toEqual([
      {
        name: "payment-terms",
        title: "Payment Terms",
        version: "2027-02-20",
        from: "2027-04-12",
        accepted: true,
        words: "From 12 April 2027 a new version of the Payment Terms applies. You will be asked to accept it then.",
        link: "Read it",
        href: "/payment-terms?version=2027-02-20",
      },
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/contribution|project|tip|refunded/i);
  });
});
