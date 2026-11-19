import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeCopy } from "./copy";
import { isAnimatedPng, PICTURE, pictureKind, ProjectError } from "./rules";

/** A picture made here, of plain colour or of noise (noise does not shrink well, which is the point of it). */
function raw(width: number, height: number, noise = false) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = noise ? (i * 31 + ((i / 7) | 0) * 17 + ((i * i) % 251)) % 256 : (i % 3) * 90;
  return sharp(data, { raw: { width, height, channels: 3 } });
}
const refusal = async (file: Buffer) => makeCopy(file).then(() => "nothing refused it", (error) => (error instanceof ProjectError ? error.message : `not a refusal for the host: ${error}`));

describe("what kind of file an upload is", () => {
  it("reads JPEG, PNG and WebP from the first bytes", async () => {
    expect(pictureKind(await raw(120, 120).jpeg().toBuffer())).toBe("jpeg");
    expect(pictureKind(await raw(120, 120).png().toBuffer())).toBe("png");
    expect(pictureKind(await raw(120, 120).webp().toBuffer())).toBe("webp");
  });
  it("knows nothing else: a GIF, an SVG, text, an empty file", async () => {
    expect(pictureKind(await raw(120, 120).gif().toBuffer())).toBeNull();
    expect(pictureKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(pictureKind(Buffer.from("just some words"))).toBeNull();
    expect(pictureKind(Buffer.alloc(0))).toBeNull();
  });
  it("tells an animated PNG from a still one", async () => {
    const still = await raw(120, 120).png().toBuffer();
    expect(isAnimatedPng(still)).toBe(false);
    // The same file with the part that marks an animation put in after the header's first part (IHDR: 8 + 25 bytes).
    const mark = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(8), Buffer.alloc(4)]);
    const animated = Buffer.concat([still.subarray(0, 33), mark, still.subarray(33)]);
    expect(isAnimatedPng(animated)).toBe(true);
  });
});

describe("Connect's own copy of a picture", () => {
  it("is a JPEG in standard colours, no larger than 1,600 pixels and 1 MB", async () => {
    const copy = await makeCopy(await raw(4000, 3000).jpeg().toBuffer());
    const seen = await sharp(copy.bytes).metadata();
    expect(seen.format).toBe("jpeg");
    expect(seen.space).toBe("srgb");
    expect([copy.width, copy.height]).toEqual([1600, 1200]);
    expect([seen.width, seen.height]).toEqual([1600, 1200]);
    expect(copy.bytes.length).toBeLessThanOrEqual(PICTURE.maxBytes);
  });
  it("does not make a small picture larger", async () => {
    const copy = await makeCopy(await raw(300, 200).png().toBuffer());
    expect([copy.width, copy.height]).toEqual([300, 200]);
  });
  it("leaves out everything hidden in the file: the place, the camera, the way up", async () => {
    const withPlace = await raw(400, 300)
      .withExif({ IFD0: { Make: "A phone", Software: "Some app" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withPlace).metadata()).exif).toBeDefined();
    const seen = await sharp((await makeCopy(withPlace)).bytes).metadata();
    expect(seen.exif).toBeUndefined();
    expect(seen.icc).toBeUndefined();
    expect(seen.xmp).toBeUndefined();
    expect(seen.orientation).toBeUndefined();
  });
  it("turns a sideways photo the right way up before the note about it is dropped", async () => {
    // 400 wide and 300 high as stored, marked "turn a quarter": the picture a person sees is 300 wide and 400 high.
    const sideways = await raw(400, 300).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const copy = await makeCopy(sideways);
    expect([copy.width, copy.height]).toEqual([300, 400]);
  });
  it("turns a printer's colours and a wide-colour picture into standard colours", async () => {
    const printers = await raw(300, 300).toColourspace("cmyk").jpeg().toBuffer();
    expect((await sharp(printers).metadata()).space).toBe("cmyk");
    const fromPrinters = await sharp((await makeCopy(printers)).bytes).metadata();
    expect([fromPrinters.space, fromPrinters.channels]).toEqual(["srgb", 3]);
    const wide = await raw(300, 300).withIccProfile("p3").jpeg().toBuffer();
    expect((await sharp(wide).metadata()).icc).toBeDefined();
    const fromWide = await sharp((await makeCopy(wide)).bytes).metadata();
    expect([fromWide.space, fromWide.icc]).toEqual(["srgb", undefined]);
  });
  it("puts white behind anything see-through", async () => {
    const clear = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const copy = await makeCopy(clear);
    const { data } = await sharp(copy.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((value) => value > 250)).toBe(true);
  });
  it("lowers the quality until a very detailed picture fits under 1 MB", async () => {
    const detailed = await raw(1600, 1600, true).jpeg({ quality: 95 }).toBuffer();
    // At the first quality this picture really is too large, so the copy can only have been made at a lower one.
    const atFirst = await sharp(detailed).jpeg({ quality: PICTURE.qualities[0], mozjpeg: true }).toBuffer();
    expect(atFirst.length).toBeGreaterThan(PICTURE.maxBytes);
    const copy = await makeCopy(detailed);
    expect(copy.bytes.length).toBeLessThanOrEqual(PICTURE.maxBytes);
  });

  it("refuses what is not a JPEG, PNG or WebP, whatever it is called", async () => {
    expect(await refusal(await raw(200, 200).gif().toBuffer())).toMatch(/JPEG, PNG or WebP/);
    expect(await refusal(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"></svg>'))).toMatch(/JPEG, PNG or WebP/);
    expect(await refusal(Buffer.from("not a picture at all"))).toMatch(/JPEG, PNG or WebP/);
  });
  it("refuses a file that only starts like a picture, and a broken one", async () => {
    expect(await refusal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("and then nothing a picture has")]))).toMatch(/could not be read/);
    const good = await raw(400, 400, true).jpeg().toBuffer();
    expect(await refusal(good.subarray(0, Math.floor(good.length / 3)))).toMatch(/could not be read/);
  });
  it("refuses a picture that moves: an animated WebP and an animated PNG", async () => {
    const frames = await sharp(Buffer.concat([await raw(120, 120).raw().toBuffer(), await raw(120, 120, true).raw().toBuffer()]), { raw: { width: 120, height: 240, channels: 3, pageHeight: 120 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(frames).metadata()).pages).toBe(2);
    expect(await refusal(frames)).toMatch(/moves/);
    const still = await raw(120, 120).png().toBuffer();
    const mark = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(8), Buffer.alloc(4)]);
    expect(await refusal(Buffer.concat([still.subarray(0, 33), mark, still.subarray(33)]))).toMatch(/moves/);
  });
  it("refuses a picture that is too small, and one that would unpack into too many points", async () => {
    expect(await refusal(await raw(99, 400).jpeg().toBuffer())).toMatch(/too small/);
    // 8,000 by 7,000 is 56 million points, in a file of a few kilobytes.
    const huge = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: "#336699" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(PICTURE.uploadMaxBytes);
    expect(await refusal(huge)).toMatch(/too large|could not be read/);
  });
  it("refuses a file over 10 MB without looking further", async () => {
    expect(await refusal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PICTURE.uploadMaxBytes)]))).toMatch(/10 MB/);
  });
});
