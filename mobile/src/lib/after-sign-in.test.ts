import { rememberHostPage, takeHostPage } from "./after-sign-in";

describe("where a visitor wanted to go on", () => {
  it("is a host's page, given once", () => {
    rememberHostPage("maya", 1_000);
    expect(takeHostPage(2_000)).toBe("maya");
    expect(takeHostPage(3_000)).toBeNull();
  });
  it("is forgotten after half an hour", () => {
    rememberHostPage("maya", 0);
    expect(takeHostPage(31 * 60_000)).toBeNull();
  });
  it("is never anything but a plain handle", () => {
    rememberHostPage("../bookings/1", 0);
    expect(takeHostPage(1)).toBeNull();
    rememberHostPage("maya?x=1", 0);
    expect(takeHostPage(1)).toBeNull();
  });
});
