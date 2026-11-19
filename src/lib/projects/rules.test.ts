import { describe, expect, it } from "vitest";
import { type AskFacts, firstLines, linksOf, linksToText, mayAsk, PROJECT, ProjectError, projectProblem, readPost, tidyName, tidyText, youtubeLink } from "./rules";

const VIDEO = "dQw4w9WgXcQ";

describe("a YouTube address", () => {
  it("takes a watch link, with or without www, and on the phone site", () => {
    expect(youtubeLink(`https://www.youtube.com/watch?v=${VIDEO}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(youtubeLink(`https://youtube.com/watch?v=${VIDEO}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(youtubeLink(`https://m.youtube.com/watch?v=${VIDEO}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
  });
  it("takes a short link, a short, a live video and a channel", () => {
    expect(youtubeLink(`https://youtu.be/${VIDEO}`)).toBe(`https://youtu.be/${VIDEO}`);
    expect(youtubeLink(`https://www.youtube.com/shorts/${VIDEO}`)).toBe(`https://www.youtube.com/shorts/${VIDEO}`);
    expect(youtubeLink(`https://www.youtube.com/live/${VIDEO}`)).toBe(`https://www.youtube.com/live/${VIDEO}`);
    expect(youtubeLink("https://www.youtube.com/@some.channel_1")).toBe("https://www.youtube.com/@some.channel_1");
    expect(youtubeLink("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBe("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv");
  });
  it("reads an address typed without https, and writes http as https", () => {
    expect(youtubeLink(`youtube.com/watch?v=${VIDEO}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(youtubeLink(`http://youtu.be/${VIDEO}`)).toBe(`https://youtu.be/${VIDEO}`);
    expect(youtubeLink(`  https://youtu.be/${VIDEO}  `)).toBe(`https://youtu.be/${VIDEO}`);
  });
  it("keeps only the video's id: nothing else that was typed comes back", () => {
    expect(youtubeLink(`https://www.youtube.com/watch?v=${VIDEO}&list=PL123&t=42s#frag`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(youtubeLink(`https://youtu.be/${VIDEO}?si=tracking`)).toBe(`https://youtu.be/${VIDEO}`);
  });
  it("reads the site's name in any capitals, and the first video named when two are", () => {
    expect(youtubeLink(`https://YOUTUBE.COM/watch?v=${VIDEO}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(youtubeLink(`https://youtube.com/watch?v=bad&v=${VIDEO}`)).toBeNull();
  });
  it("takes a channel's name in another alphabet, typed as it reads or as a browser copies it, and keeps one form", () => {
    const kept = "https://www.youtube.com/@%E6%98%A0%E7%94%BB%E6%97%A5%E8%A8%98";
    expect(youtubeLink("https://www.youtube.com/@映画日記")).toBe(kept);
    expect(youtubeLink(kept)).toBe(kept);
    expect(linksOf(linksToText([kept]))).toEqual([kept]);
    expect(youtubeLink("https://www.youtube.com/@some.channel_1")).toBe("https://www.youtube.com/@some.channel_1");
    // The longest name there can be, in letters that take the most room when written out: what we keep must read back.
    const longest = `https://www.youtube.com/@${"𠀀".repeat(30)}`;
    const keptLongest = youtubeLink(longest)!;
    expect(keptLongest.length).toBeLessThanOrEqual(PROJECT.linkMax);
    expect(youtubeLink(keptLongest)).toBe(keptLongest);
    expect(linksOf(linksToText([keptLongest]))).toEqual([keptLongest]);
    expect(youtubeLink(`https://www.youtube.com/@${"𠀀".repeat(31)}`)).toBeNull();
    // Not a name: a broken code, a slash or a tag hidden in codes, a name that is too short.
    expect(youtubeLink("https://www.youtube.com/@%E6%98")).toBeNull();
    expect(youtubeLink("https://www.youtube.com/@abc%2Fwatch")).toBeNull();
    expect(youtubeLink("https://www.youtube.com/@%3Cscript%3E")).toBeNull();
    expect(youtubeLink("https://www.youtube.com/@%E6%98%A0")).toBeNull();
  });
  it("refuses every other site, also ones that look like YouTube", () => {
    for (const typed of [
      `https://example.com/watch?v=${VIDEO}`,
      `https://youtube.com.example.com/watch?v=${VIDEO}`,
      `https://notyoutube.com/watch?v=${VIDEO}`,
      `https://www.youtube.com@example.com/watch?v=${VIDEO}`,
      `https://music.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be.example.com/${VIDEO}`,
    ]) {
      expect(youtubeLink(typed), typed).toBeNull();
    }
  });
  it("refuses anything that is not a web address of a video or a channel", () => {
    for (const typed of [
      "",
      "hello",
      "javascript:alert(1)",
      `ftp://youtube.com/watch?v=${VIDEO}`,
      "https://www.youtube.com/",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?v=tooshort",
      `https://www.youtube.com/watch?v=${VIDEO}x`,
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/results?search_query=x",
      `https://www.youtube.com:8443/watch?v=${VIDEO}`,
      `https://user:pass@www.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}/extra`,
      `https://www.youtube.com/watch?v=${VIDEO} and more`,
      `https://www.youtube.com/watch?v=<script>`,
      "https://www.youtube.com/@a",
    ]) {
      expect(youtubeLink(typed), typed).toBeNull();
    }
  });
});

describe("a project's name and description", () => {
  it("accepts a name of 2 to 80 characters and a description up to 1,000", () => {
    expect(projectProblem({ name: "My film", description: "" })).toBeNull();
    expect(projectProblem({ name: "x".repeat(PROJECT.nameMax), description: "y".repeat(PROJECT.descriptionMax) })).toBeNull();
  });
  it("refuses a missing or too long name, and a too long description", () => {
    expect(projectProblem({ name: "", description: "" })).toMatch(/name/);
    expect(projectProblem({ name: "x", description: "" })).toMatch(/name/);
    expect(projectProblem({ name: "x".repeat(PROJECT.nameMax + 1), description: "" })).toMatch(/80/);
    expect(projectProblem({ name: "My film", description: "y".repeat(PROJECT.descriptionMax + 1) })).toMatch(/1000/);
  });
  it("tidies a name to one line and text to plain line ends", () => {
    expect(tidyName("  My \n film  ")).toBe("My film");
    expect(tidyText("  one\r\ntwo\rthree  ")).toBe("one\ntwo\nthree");
  });
  it("takes out characters nobody can see, and keeps new lines and tabs", () => {
    expect(tidyText("one\u0000two\u0007\n\tthree\u007f")).toBe("onetwo\n\tthree");
    expect(tidyName("My\u0000 film\u001f")).toBe("My film");
    expect(readPost({ text: "Day\u0000 one", links: [] }).text).toBe("Day one");
  });
});

describe("a post", () => {
  it("keeps the tidied text and the YouTube links, each once, empty boxes left out", () => {
    expect(readPost({ text: "  Day one.\r\nWe started.  ", links: ["", `youtu.be/${VIDEO}`, `https://youtu.be/${VIDEO}`, "  "] })).toEqual({
      text: "Day one.\nWe started.",
      links: [`https://youtu.be/${VIDEO}`],
    });
  });
  it("needs some text, and not more than 5,000 characters", () => {
    expect(() => readPost({ text: "   ", links: [] })).toThrow(ProjectError);
    expect(readPost({ text: "x".repeat(PROJECT.postTextMax), links: [] }).text).toHaveLength(PROJECT.postTextMax);
    expect(() => readPost({ text: "x".repeat(PROJECT.postTextMax + 1), links: [] })).toThrow(/5000/);
  });
  it("refuses a link that is not a YouTube address, and more than three links", () => {
    expect(() => readPost({ text: "Hello", links: ["https://example.com/video"] })).toThrow(/YouTube/);
    const four = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map((id) => `https://youtu.be/${id}`);
    expect(readPost({ text: "Hello", links: four.slice(0, 3) }).links).toHaveLength(3);
    expect(() => readPost({ text: "Hello", links: four })).toThrow(/up to 3/);
  });
  it("keeps links one per line, and reads back only what is still a YouTube address", () => {
    const links = [`https://youtu.be/${VIDEO}`, `https://www.youtube.com/watch?v=${VIDEO}`];
    expect(linksOf(linksToText(links))).toEqual(links);
    expect(linksOf("")).toEqual([]);
    // A line that was changed by hand in the database into something else is not shown as a link.
    expect(linksOf(`https://youtu.be/${VIDEO}\nhttps://example.com/x\njavascript:alert(1)`)).toEqual([`https://youtu.be/${VIDEO}`]);
  });
});

describe("the first lines of a text", () => {
  it("gives a short text back whole, on one line", () => {
    expect(firstLines("Hello\n\nthere", 50)).toBe("Hello there");
  });
  it("cuts a long text at a word and marks the cut", () => {
    const cut = firstLines("one two three four five six seven eight nine ten", 20);
    expect(cut.length).toBeLessThanOrEqual(21);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).toBe("one two three four…");
  });
});

describe("the box after a call", () => {
  // A customer after a call that took place, with a host whose project they could contribute to and do not yet.
  const all: AskFacts = {
    role: "customer",
    cancelled: false,
    safetyEnded: false,
    recordFinal: true,
    togetherSeconds: 600,
    reported: false,
    blocked: false,
    refundAsked: false,
    projectShown: true,
    mayContribute: true,
    alreadyContributes: false,
  };
  it("is shown when every condition holds", () => {
    expect(mayAsk(all)).toBe(true);
    // One second together is a call that took place.
    expect(mayAsk({ ...all, togetherSeconds: 1 })).toBe(true);
  });
  it("is never shown to the host or to the founder", () => {
    expect(mayAsk({ ...all, role: "host" })).toBe(false);
    expect(mayAsk({ ...all, role: "admin" })).toBe(false);
  });
  it("is not shown for a call that did not take place", () => {
    expect(mayAsk({ ...all, cancelled: true })).toBe(false);
    expect(mayAsk({ ...all, togetherSeconds: 0 })).toBe(false);
    expect(mayAsk({ ...all, togetherSeconds: null })).toBe(false);
  });
  it("waits for the call's record to be final, and is not shown for a record that needs review", () => {
    expect(mayAsk({ ...all, recordFinal: false })).toBe(false);
  });
  it("is not shown after End call and report, a report, a block or a refund request", () => {
    expect(mayAsk({ ...all, safetyEnded: true })).toBe(false);
    expect(mayAsk({ ...all, reported: true })).toBe(false);
    expect(mayAsk({ ...all, blocked: true })).toBe(false);
    expect(mayAsk({ ...all, refundAsked: true })).toBe(false);
  });
  it("is not shown without a project the customer could contribute to", () => {
    expect(mayAsk({ ...all, projectShown: false })).toBe(false);
    expect(mayAsk({ ...all, mayContribute: false })).toBe(false);
  });
  it("is not shown to someone who already contributes", () => {
    expect(mayAsk({ ...all, alreadyContributes: true })).toBe(false);
  });
});
