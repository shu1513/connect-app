import { describe, expect, it } from "vitest";
import { firstLines, linksOf, linksToText, PROJECT, ProjectError, projectProblem, readPost, tidyName, tidyText, youtubeLink } from "./rules";

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
