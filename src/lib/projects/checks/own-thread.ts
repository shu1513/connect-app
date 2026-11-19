/**
 * Connect's own picture checker, the part that runs in a thread of its own (plans/24, "The
 * open-source checker's thread"). It is the open-source NSFWJS with its small model, on
 * TensorFlow's WASM engine. It only looks for nudity.
 *
 * Everything heavy happens here and nowhere else: reading the JPEG, preparing it, and the model
 * itself. So none of it ever runs in the helper's own loops, which close calls and move money.
 * What it needs is loaded from the app's own packages; nothing is fetched from the internet.
 *
 * It answers each picture with the model's five classes and their numbers, or with an error.
 * What those numbers mean for a picture is decided outside (own.ts), not here.
 */
import { parentPort } from "node:worker_threads";
import sharp from "sharp";

type Job = { id: number; jpeg: Uint8Array };
export type OwnReply = { ready: true } | { id: number; classes: Array<{ className: string; probability: number }> } | { id: number; error: string } | { failed: string };

async function main() {
  const port = parentPort;
  if (!port) throw new Error("This file only runs as a thread of the helper.");
  const tf = await import("@tensorflow/tfjs");
  await import("@tensorflow/tfjs-backend-wasm");
  const { load } = await import("nsfwjs/core");
  const { MobileNetV2Model } = await import("nsfwjs/models/mobilenet_v2");
  await tf.setBackend("wasm");
  await tf.ready();
  // Checked, not assumed: the plain engine would work too, at a tenth of the speed, and nobody would notice.
  if (tf.getBackend() !== "wasm") throw new Error(`The WASM engine is not in use (the engine is "${tf.getBackend()}").`);
  const model = await load("MobileNetV2", { modelDefinitions: [MobileNetV2Model] });
  port.postMessage({ ready: true } satisfies OwnReply);

  port.on("message", async (job: Job) => {
    try {
      // The model takes a picture of 224 by 224 points, three colours each.
      const { data, info } = await sharp(Buffer.from(job.jpeg), { limitInputPixels: 50_000_000 }).resize(224, 224, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const picture = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
      try {
        const classes = await model.classify(picture, 5);
        port.postMessage({ id: job.id, classes: classes.map((c) => ({ className: String(c.className), probability: c.probability })) } satisfies OwnReply);
      } finally {
        picture.dispose();
      }
    } catch (error) {
      port.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) } satisfies OwnReply);
    }
  });
}

main().catch((error) => {
  parentPort?.postMessage({ failed: error instanceof Error ? error.message : String(error) } satisfies OwnReply);
  process.exit(1);
});
