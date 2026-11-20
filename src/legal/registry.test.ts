import { describe, expect, it } from "vitest";
import { parse } from "./parse";
import { agreementsToAccept, blanksIn, comingVersion, currentVersion, DOCUMENT_NAMES, DOCUMENTS, generalStamp, linkFor, registryProblems, TEXTS, textOf, versionHref, versionsOf, type DocumentVersion } from "./registry";

const at = (iso: string) => new Date(iso);

describe("the list of legal documents", () => {
  it("has nothing wrong with it", () => {
    expect(registryProblems()).toEqual([]);
  });

  it("every version of every document is read without a single problem, and starts with its title", () => {
    for (const name of DOCUMENT_NAMES) {
      for (const version of versionsOf(name)) {
        const { blocks, problems } = parse(textOf(name, version.version)!, linkFor);
        expect(problems, `${name} ${version.version}`).toEqual([]);
        expect(blocks[0], `${name} ${version.version}`).toMatchObject({ t: "heading", level: 1 });
      }
    }
  });

  it("a draft may hold blanks, and they are found", () => {
    expect(blanksIn("Run by [COMPANY NAME] at [ADDRESS], and again [COMPANY NAME].")).toEqual(["[COMPANY NAME]", "[ADDRESS]"]);
    expect(blanksIn(textOf("terms-of-service", "2026-11-20")!)).toContain("[COMPANY NAME]");
    expect(blanksIn("An option [as shown] here.")).toEqual([]);
    // A blank wrapped over two lines, and a number still to be settled: both must stop a version from being published.
    expect(blanksIn("write to [LEGAL\nEMAIL] or [ADDRESS].")).toEqual(["[LEGAL EMAIL]", "[ADDRESS]"]);
    expect(blanksIn("for [12] months")).toEqual(["[12]"]);
    expect(blanksIn(textOf("terms-of-service", "2026-11-20")!)).toContain("[LEGAL EMAIL]");
    expect(blanksIn(textOf("host-agreement", "2026-11-20")!)).toContain("[12]");
  });

  it("links between the documents lead to their pages", () => {
    expect(linkFor("payment-terms.md")).toEqual({ href: "/payment-terms", outside: false });
    expect(linkFor("https://stripe.com/privacy")).toEqual({ href: "https://stripe.com/privacy", outside: true });
    expect(linkFor("no-such-document.md")).toBeNull();
  });
});

describe("which version is in effect", () => {
  const extra = (over: Partial<DocumentVersion>): DocumentVersion => ({ version: "2027-03-01", effectiveFrom: "2027-04-15", addedOn: "2027-03-01", draft: false, summary: "A change.", ...over });
  const withExtra = <T>(version: DocumentVersion, run: () => T): T => {
    DOCUMENTS["terms-of-service"].versions.push(version);
    try {
      return run();
    } finally {
      DOCUMENTS["terms-of-service"].versions.pop();
    }
  };

  it("is the first one from the start", () => {
    expect(currentVersion("terms-of-service", at("2026-11-20T00:00:00Z")).version).toBe("2026-11-20");
    expect(comingVersion("terms-of-service", at("2026-12-01T00:00:00Z"))).toBeNull();
  });

  it("a version whose day has not come is coming, and becomes the current one on its day, at the start of the day in UTC", () => {
    withExtra(extra({}), () => {
      expect(currentVersion("terms-of-service", at("2027-04-14T23:59:59Z")).version).toBe("2026-11-20");
      expect(comingVersion("terms-of-service", at("2027-04-14T23:59:59Z"))?.version).toBe("2027-03-01");
      expect(currentVersion("terms-of-service", at("2027-04-15T00:00:00Z")).version).toBe("2027-03-01");
      expect(comingVersion("terms-of-service", at("2027-04-15T00:00:00Z"))).toBeNull();
    });
  });

  it("the stamp names the three general documents, and changes only when one of them does", () => {
    const before = generalStamp(at("2026-12-01T00:00:00Z"));
    expect(before).toBe("terms-of-service@2026-11-20|payment-terms@2026-11-20|community-rules@2026-11-20");
    withExtra(extra({}), () => {
      expect(generalStamp(at("2027-04-14T12:00:00Z"))).toBe(before);
      expect(generalStamp(at("2027-04-15T12:00:00Z"))).toBe("terms-of-service@2027-03-01|payment-terms@2026-11-20|community-rules@2026-11-20");
    });
    // A new Host Agreement sends nobody back to the welcome step.
    DOCUMENTS["host-agreement"].versions.push(extra({}));
    try {
      expect(generalStamp(at("2027-05-01T00:00:00Z"))).toBe(before);
    } finally {
      DOCUMENTS["host-agreement"].versions.pop();
    }
  });

  it("what is asked at sign-up and for hosting, each with the address of exactly that version", () => {
    const signUp = agreementsToAccept("sign_up", at("2026-12-01T00:00:00Z"));
    expect(signUp.map((a) => [a.name, a.version, a.href])).toEqual([
      ["terms-of-service", "2026-11-20", "/terms?version=2026-11-20"],
      ["payment-terms", "2026-11-20", "/payment-terms?version=2026-11-20"],
      ["community-rules", "2026-11-20", "/rules?version=2026-11-20"],
    ]);
    expect(agreementsToAccept("hosting", at("2026-12-01T00:00:00Z")).map((a) => a.name)).toEqual(["host-agreement"]);
    expect(versionHref("privacy-policy", "2026-11-20")).toBe("/privacy?version=2026-11-20");
  });
});

describe("what the list refuses", () => {
  const PLAIN = "# Payment Terms\n\nNo blanks.";
  /** The list's problems with one more version of the Payment Terms, and, if asked, with its first version turned into a published one. */
  const check = (version: DocumentVersion, text: string = PLAIN, firstPublished = false): string[] => {
    const versions = DOCUMENTS["payment-terms"].versions;
    const texts = TEXTS["payment-terms"];
    const original = { ...versions[0] };
    const originalText = texts[versions[0].version];
    if (firstPublished) {
      versions[0].draft = false;
      texts[versions[0].version] = PLAIN;
    }
    versions.push(version);
    const had = texts[version.version];
    texts[version.version] = text;
    try {
      return registryProblems();
    } finally {
      versions.pop();
      if (had === undefined) delete texts[version.version];
      else texts[version.version] = had;
      Object.assign(versions[0], original);
      texts[versions[0].version] = originalText;
    }
  };
  const next: DocumentVersion = { version: "2027-03-01", effectiveFrom: "2027-04-15", addedOn: "2027-03-01", draft: false, summary: "A change." };

  it("a published version that still has a blank", () => {
    expect(check(next, "# Payment Terms\n\nRun by [COMPANY NAME].").join(" ")).toMatch(/published but still has blanks/);
    expect(check(next, " ").join(" ")).toMatch(/has no text/);
  });

  it("a published version that follows a published one with less than 30 days' notice, unless it says why", () => {
    expect(check({ ...next, effectiveFrom: "2027-03-20" }, PLAIN, true).join(" ")).toMatch(/less than 30 days/);
    expect(check({ ...next, effectiveFrom: "2027-03-31" }, PLAIN, true)).toEqual([]);
    expect(check({ ...next, effectiveFrom: "2027-03-05", urgent: "A court order of 3 March 2027." }, PLAIN, true)).toEqual([]);
  });

  it("but not a first published version after a draft: nothing was in force before it", () => {
    expect(check({ ...next, effectiveFrom: "2027-03-02" })).toEqual([]);
  });

  it("a later version that does not say what changed, and a draft after a published version", () => {
    expect(check({ ...next, summary: " " }).join(" ")).toMatch(/does not say what changed/);
    expect(check({ ...next, draft: true }, PLAIN, true).join(" ")).toMatch(/draft after a published version/);
  });
});
