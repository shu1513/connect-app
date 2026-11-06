import { describe, expect, it } from "vitest";
import { readSocialName } from "./social";

describe("readSocialName", () => {
  it("reads a plain name, with or without @, in any capitals", () => {
    expect(readSocialName("instagram", "@Jane.Doe")).toEqual({ nameKey: "jane.doe", url: "https://www.instagram.com/jane.doe/" });
    expect(readSocialName("instagram", "  jane_doe  ")).toEqual({ nameKey: "jane_doe", url: "https://www.instagram.com/jane_doe/" });
    expect(readSocialName("x", "JaneDoe")).toEqual({ nameKey: "janedoe", url: "https://x.com/janedoe" });
  });

  it("reads a full link to the account", () => {
    expect(readSocialName("instagram", "https://www.instagram.com/Jane.Doe/?hl=en")).toEqual({
      nameKey: "jane.doe",
      url: "https://www.instagram.com/jane.doe/",
    });
    expect(readSocialName("tiktok", "tiktok.com/@jane")).toEqual({ nameKey: "jane", url: "https://www.tiktok.com/@jane" });
    expect(readSocialName("youtube", "https://m.youtube.com/@Jane-Doe/videos")).toEqual({
      nameKey: "jane-doe",
      url: "https://www.youtube.com/@jane-doe",
    });
    expect(readSocialName("x", "https://twitter.com/jane_doe")).toEqual({ nameKey: "jane_doe", url: "https://x.com/jane_doe" });
  });

  it("always builds the link itself, never keeps the one that was typed", () => {
    const read = readSocialName("instagram", "https://instagram.com/jane?next=https://evil.example");
    expect(read).toEqual({ nameKey: "jane", url: "https://www.instagram.com/jane/" });
  });

  it("refuses a link to a different site", () => {
    expect(readSocialName("instagram", "https://evil.example/jane")).toHaveProperty("problem");
    expect(readSocialName("instagram", "https://instagram.com.evil.example/jane")).toHaveProperty("problem");
    expect(readSocialName("x", "https://www.instagram.com/jane")).toHaveProperty("problem");
  });

  it("refuses names the network does not allow", () => {
    expect(readSocialName("x", "this_name_is_far_too_long")).toHaveProperty("problem");
    expect(readSocialName("x", "jane.doe")).toHaveProperty("problem");
    expect(readSocialName("instagram", "jane doe")).toHaveProperty("problem");
    expect(readSocialName("instagram", "jаne")).toHaveProperty("problem"); // Cyrillic look-alike
    expect(readSocialName("instagram", "")).toHaveProperty("problem");
    expect(readSocialName("tiktok", "<script>")).toHaveProperty("problem");
  });

  it("asks for the @name when given a YouTube channel-number link", () => {
    expect(readSocialName("youtube", "https://www.youtube.com/channel/UC1234567890")).toHaveProperty("problem");
  });

  it("refuses links that lead to a post or another page of the site, not to an account", () => {
    expect(readSocialName("instagram", "https://www.instagram.com/p/Cabc123/")).toHaveProperty("problem");
    expect(readSocialName("instagram", "https://www.instagram.com/reel/Cabc123/")).toHaveProperty("problem");
    expect(readSocialName("instagram", "https://www.instagram.com/")).toHaveProperty("problem");
    expect(readSocialName("tiktok", "https://www.tiktok.com/video/123")).toHaveProperty("problem");
    expect(readSocialName("youtube", "https://www.youtube.com/watch?v=abc")).toHaveProperty("problem");
    expect(readSocialName("x", "https://x.com/home")).toHaveProperty("problem");
    expect(readSocialName("x", "https://x.com/i/status/123")).toHaveProperty("problem");
  });
});
