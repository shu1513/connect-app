import { isIdentityNotice, isLegalText, legalLink } from "./legal-rules";

const text = [
  { t: "heading", level: 1, c: [{ t: "text", v: "Identity Check Notice" }], plain: "Identity Check Notice" },
  { t: "paragraph", c: [{ t: "text", v: "Stripe compares " }, { t: "bold", c: [{ t: "text", v: "a picture of your face" }] }, { t: "text", v: " with your ID. See the " }, { t: "link", href: "/privacy", outside: false, c: [{ t: "text", v: "Privacy Policy" }] }, { t: "text", v: "." }] },
  { t: "list", ordered: true, start: 2, items: [[{ t: "text", v: "one" }], [{ t: "blank", v: "[COMPANY NAME]" }]] },
  { t: "table", head: [[{ t: "text", v: "What" }], [{ t: "text", v: "How long" }]], rows: [[[{ t: "text", v: "The result" }], [{ t: "text", v: "While the account is open" }]]] },
  { t: "quote", lines: [[{ t: "text", v: "Connect" }], [{ t: "text", v: "1 Example Street" }]] },
  { t: "line" },
];
const notice = { name: "identity-check-notice", version: "2026-11-20", title: "Identity Check Notice", href: "/identity-notice?version=2026-11-20", open: "open it on its own page", blocks: text, agree: "By pressing the button you agree." };

describe("a legal text for the app", () => {
  it("takes a text made of the pieces the website's reader gives", () => {
    expect(isLegalText(text)).toBe(true);
    expect(isIdentityNotice(notice)).toBe(true);
  });

  it("refuses the whole text when one piece is not known, so nothing is silently left out", () => {
    expect(isLegalText([])).toBe(false);
    expect(isLegalText("…")).toBe(false);
    expect(isLegalText([...text, { t: "picture", src: "x" }])).toBe(false);
    expect(isLegalText([{ t: "paragraph", c: [{ t: "text", v: 5 }] }])).toBe(false);
    expect(isLegalText([{ t: "paragraph", c: [{ t: "script", v: "x" }] }])).toBe(false);
    expect(isLegalText([{ t: "heading", level: 4, c: [], plain: "" }])).toBe(false);
    expect(isLegalText([{ t: "list", ordered: true, start: 1.5, items: [] }])).toBe(false);
    expect(isLegalText([{ t: "table", head: [], rows: [[{ t: "text", v: "not a cell" }]] }])).toBe(false);
  });

  it("refuses a notice with a part missing", () => {
    for (const part of ["name", "version", "title", "href", "open", "blocks", "agree"]) {
      const rest: Record<string, unknown> = { ...notice };
      delete rest[part];
      expect(isIdentityNotice(rest)).toBe(false);
    }
    expect(isIdentityNotice({ ...notice, version: "" })).toBe(false);
    // It is the identity notice and no other document, and its link is the address of exactly the version it names.
    expect(isIdentityNotice({ ...notice, name: "terms-of-service" })).toBe(false);
    expect(isIdentityNotice({ ...notice, href: "/identity-notice?version=2020-01-01" })).toBe(false);
    expect(isIdentityNotice({ ...notice, href: "/identity-notice" })).toBe(false);
    expect(isIdentityNotice({ ...notice, href: "/terms?version=2026-11-20" })).toBe(false);
    expect(isIdentityNotice({ ...notice, agree: "" })).toBe(false);
    expect(isIdentityNotice(null)).toBe(false);
  });
});

describe("a link inside a legal text", () => {
  it("leads to a page of the website, an https address outside, or an email address", () => {
    expect(legalLink({ href: "/privacy", outside: false })).toEqual({ kind: "page", path: "/privacy" });
    expect(legalLink({ href: "/terms?version=2026-11-20", outside: false })).toEqual({ kind: "page", path: "/terms?version=2026-11-20" });
    expect(legalLink({ href: "https://stripe.com/privacy", outside: true })).toEqual({ kind: "outside", url: "https://stripe.com/privacy" });
    expect(legalLink({ href: "mailto:support@connect.example", outside: true })).toEqual({ kind: "mail", url: "mailto:support@connect.example" });
  });

  it("leads nowhere for anything else", () => {
    expect(legalLink({ href: "//evil.example/x", outside: false })).toBeNull();
    expect(legalLink({ href: "https://evil.example", outside: false })).toBeNull();
    expect(legalLink({ href: "#", outside: false })).toBeNull();
    expect(legalLink({ href: "http://stripe.com", outside: true })).toBeNull();
    expect(legalLink({ href: "javascript:alert(1)", outside: true })).toBeNull();
    expect(legalLink({ href: "https://user:pw@stripe.com", outside: true })).toBeNull();
    expect(legalLink({ href: "connect://identity", outside: true })).toBeNull();
    expect(legalLink({ href: "not an address", outside: true })).toBeNull();
    expect(legalLink({ href: "mailto:?subject=help@example.org", outside: true })).toBeNull();
    expect(legalLink({ href: "mailto:a@example.org?cc=b@example.org", outside: true })).toBeNull();
    expect(legalLink({ href: "mailto:a@example.org,b@example.org", outside: true })).toBeNull();
  });
});
