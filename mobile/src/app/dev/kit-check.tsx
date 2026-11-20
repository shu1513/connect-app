import { expoClient } from "@better-auth/expo/client";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { initStripe } from "@stripe/stripe-react-native";
import { createAuthClient } from "better-auth/react";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Room } from "livekit-client";
import { useEffect, useState } from "react";
import { SERVER } from "@/lib/config";
import { Button, Card, Loading, Page, Words } from "@/ui/pieces";

/**
 * A test screen, only reachable in a test build: it makes each kit the app stands on prove that
 * it is alive on this phone (plans/45-phone-apps/02-the-frame.md, decision 2). The video kit
 * starts, Stripe's kit takes the test key, the sign-in kit can be made, and the secure store keeps
 * a value across a restart of the app.
 */

/** LiveKit's parts are put in place when the check runs, once, and not merely because this file was read. */
let videoPartsReady = false;

type Line = { name: string; ok: boolean; detail: string };

async function checkKits(): Promise<Line[]> {
  const lines: Line[] = [];
  const run = async (name: string, work: () => Promise<string>) => {
    try {
      lines.push({ name, ok: true, detail: await work() });
    } catch (error) {
      lines.push({ name, ok: false, detail: String(error).slice(0, 200) });
    }
  };
  await run("The secure store", async () => {
    const before = await SecureStore.getItemAsync("kit-check");
    const now = new Date().toISOString();
    await SecureStore.setItemAsync("kit-check", now);
    const read = await SecureStore.getItemAsync("kit-check");
    if (read !== now) throw new Error("what was kept is not what was read back");
    return before ? `kept a value from an earlier start (${before})` : "kept a value; start the app again to see it survive";
  });
  await run("Stripe", async () => {
    const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
    if (!key.startsWith("pk_test_")) throw new Error("no test key was set for this build");
    await initStripe({ publishableKey: key });
    return "took the test key";
  });
  await run("LiveKit: the parts for video", async () => {
    if (!videoPartsReady) {
      registerGlobals();
      videoPartsReady = true;
    }
    const kind = typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
    if (kind !== "function") throw new Error(`the video parts are missing (${kind})`);
    return `ready; a room starts as "${new Room().state}"`;
  });
  await run("LiveKit: sound", async () => {
    await AudioSession.startAudioSession();
    await AudioSession.stopAudioSession();
    return "started and stopped";
  });
  await run("The sign-in kit", async () => {
    if (!SERVER) throw new Error("no server address was set for this build");
    // Its own corner of the secure store, so that this check never touches a real sign-in.
    const client = createAuthClient({ baseURL: SERVER, plugins: [expoClient({ scheme: "connect", storagePrefix: "kit-check", storage: SecureStore })] });
    // Asks the server's login tool who is signed in. Nobody is: the point is that the question got there and back.
    const asked = await client.getSession();
    if (asked.error) throw new Error(`the server's login tool did not answer (${asked.error.status ?? "no connection"})`);
    // This check keeps no sign-in, so the one right answer is "nobody". Anything else (some other site's page, say) is not the login tool.
    if (asked.data !== null) throw new Error("something answered, but not as the server's login tool does");
    return "reached the server's login tool; nobody is signed in";
  });
  return lines;
}

export default function KitCheck() {
  const [lines, setLines] = useState<Line[] | null>(null);
  useEffect(() => {
    void checkKits().then(setLines);
  }, []);
  if (!lines) return <Loading words="Checking the kits…" />;
  return (
    <Page title="Kit check">
      {lines.map((line) => (
        <Card key={line.name}>
          <Words>
            {line.ok ? "OK" : "FAILED"} · {line.name}
          </Words>
          <Words soft>{line.detail}</Words>
        </Card>
      ))}
      <Button label="Back" kind="plain" onPress={() => router.back()} />
    </Page>
  );
}
