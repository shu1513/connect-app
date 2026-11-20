import { VideoView } from "@livekit/react-native";
import { createLocalAudioTrack, createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, StyleSheet, View } from "react-native";
import type { AppRoom } from "../../../src/lib/app-door/types";
import { Button, Loading, Notice, Tick, Words } from "@/ui/pieces";
import { useColors } from "@/ui/theme";

/** What the phone lets the app use. `asked`: the person has been asked (or never needs to be), so they are not asked again by the app. */
type May = { camera: boolean; microphone: boolean; asked: boolean };

/**
 * Android: whether the app has asked the phone for the camera and the microphone since it was opened. It asks
 * once. After a "no" it says how to allow it in the phone's settings, here and every later time this check is
 * shown, and does not ask again.
 */
let askedSinceOpened = false;

/**
 * The check before entering a call (plans/45-phone-apps/09-the-call.md, decision 2): the person
 * sees their own camera, chooses camera and microphone on or off (they may enter with both off),
 * and joins with what they chose.
 *
 * The camera and the microphone are asked for here and nowhere else, each with one plain sentence
 * on why. On Android the app asks once, when the person presses the button; if they said no it
 * says how to allow it in the phone's settings and does not ask again. On an iPhone the phone
 * itself asks, with the same sentences, the first time the camera is used.
 */
export function Lobby({ words, joining, onJoin }: { words: AppRoom["words"]; joining: boolean; onJoin: (wanted: { camera: boolean; microphone: boolean }) => void }) {
  const colors = useColors();
  const [may, setMay] = useState<May | null>(null);
  const [camera, setCamera] = useState(true);
  const [microphone, setMicrophone] = useState(true);
  const [preview, setPreview] = useState<LocalVideoTrack | null>(null);

  /** Looks at what the phone allows, without asking for anything. */
  const look = useCallback(async () => {
    if (Platform.OS !== "android") {
      // An iPhone asks by itself, the first time each of the two is used. What it said about the microphone is found
      // out by using it for a moment; about the camera, by the picture below. Both are looked at afresh each time
      // (after a visit to the phone's settings either may be allowed now).
      const heard = await createLocalAudioTrack().then(
        (track) => {
          track.stop();
          return true;
        },
        () => false,
      );
      setMay({ camera: true, microphone: heard, asked: true });
      return;
    }
    const [seen, heard] = await Promise.all([PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA), PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)]);
    setMay({ camera: seen, microphone: heard, asked: askedSinceOpened || (seen && heard) });
  }, []);
  useEffect(() => {
    // Now (as soon as this has been drawn), and on coming back from the phone's settings: what is allowed may have changed there.
    const first = setTimeout(() => void look().catch(() => setMay({ camera: false, microphone: false, asked: false })), 0);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void look().catch(() => {});
    });
    return () => {
      clearTimeout(first);
      listener.remove();
    };
  }, [look]);

  /** Asks the phone, once, after the person has read why. */
  async function allow() {
    const { CAMERA, RECORD_AUDIO } = PermissionsAndroid.PERMISSIONS;
    askedSinceOpened = true;
    const got = await PermissionsAndroid.requestMultiple([CAMERA, RECORD_AUDIO]).catch(() => null);
    setMay({ camera: got?.[CAMERA] === PermissionsAndroid.RESULTS.GRANTED, microphone: got?.[RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED, asked: true });
  }

  // The person's own camera, only while it is wanted and allowed. It is let go when this check is left.
  const showing = may?.asked === true && may.camera && camera;
  useEffect(() => {
    if (!showing) return undefined;
    let over = false;
    let made: LocalVideoTrack | null = null;
    createLocalVideoTrack({ facingMode: "user" })
      .then((track) => {
        if (over) track.stop();
        else {
          made = track;
          setPreview(track);
        }
      })
      // The phone said no (on an iPhone this is where that is found out), or has no camera to give.
      .catch(() => {
        if (!over) setMay((was) => (was ? { ...was, camera: false } : was));
      });
    return () => {
      over = true;
      made?.stop();
      setPreview(null);
    };
  }, [showing]);

  if (!may) return <Loading />;
  if (!may.asked) {
    return (
      <View style={styles.gap}>
        <Words>{words.cameraWhy}</Words>
        <Words>{words.microphoneWhy}</Words>
        <Button label={words.allow} onPress={() => void allow()} />
      </View>
    );
  }
  return (
    <View style={styles.gap}>
      <Words soft>{words.check}</Words>
      <View style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {preview && showing ? <VideoView videoTrack={preview} mirror objectFit="cover" style={styles.fill} /> : <Words soft>{words.cameraOff}</Words>}
      </View>
      {may.camera ? <Tick label={words.cameraOn} checked={camera} onChange={setCamera} /> : <Notice>{words.cameraRefused}</Notice>}
      {may.microphone ? <Tick label={words.microphoneOn} checked={microphone} onChange={setMicrophone} /> : <Notice>{words.microphoneRefused}</Notice>}
      {!may.camera || !may.microphone ? <Button label={words.openSettings} kind="plain" onPress={() => void Linking.openSettings().catch(() => {})} /> : null}
      <Button label={joining ? words.joining : words.join} busy={joining} onPress={() => onJoin({ camera: may.camera && camera, microphone: may.microphone && microphone })} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  preview: { height: 300, borderRadius: 24, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  fill: { width: "100%", height: "100%" },
});
