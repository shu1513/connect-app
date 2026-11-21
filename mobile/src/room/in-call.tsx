import Ionicons from "@expo/vector-icons/Ionicons";
import { AudioSession, isTrackReference, LiveKitRoom, useConnectionState, useLocalParticipant, useRemoteParticipants, useTracks, VideoTrack } from "@livekit/react-native";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { usePreventScreenCapture } from "expo-screen-capture";
import { ConnectionState, type DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppPass, AppRoom } from "../../../src/lib/app-door/types";
import { useWatch } from "@/lib/here";
import { type } from "@/ui/theme";

type Words = AppRoom["words"];

/**
 * A test build can be told to let pictures of the call screen be taken (`EXPO_PUBLIC_CALL_PICTURES=1`
 * in `mobile/.env.local`), so that the screen can be looked at while it is tried. A build for a
 * store never can: there the phone's own screenshots and recordings of a call show black.
 */
const PICTURES_ALLOWED = __DEV__ && process.env.EXPO_PUBLIC_CALL_PICTURES === "1";

/** While this is on the screen, the phone's screenshots and screen recordings show black (where the phone allows the app to ask for that). */
function NoPictures() {
  usePreventScreenCapture();
  return null;
}

/**
 * Inside the call (plans/45-phone-apps/09-the-call.md): the other person large, oneself small in
 * a corner, and five buttons: microphone, camera, turn the camera around, loudspeaker or
 * earpiece, leave. "End call and report" is one touch away, and asks once.
 *
 * While this is on the screen the phone stays awake, and the screen is marked so that the
 * phone's own screenshots and screen recordings show black where the phone allows that. Nothing
 * here records anything, and nothing here decides anything about time or money: the server
 * counts from the video service's own messages.
 */
export function InCall(props: {
  pass: AppPass;
  /** What the person chose in the check before entering. */
  choices: { camera: boolean; microphone: boolean };
  words: Words;
  /** The clock line, by the server's clock. */
  clock: { text: string; last: boolean };
  /** The connection ended without the person leaving: why, as the video service says it. */
  onLost: (reason?: DisconnectReason) => void;
  onLeave: () => void;
  onEndAndReport: () => void;
  onProblem: (words: string) => void;
}) {
  const { onLost } = props;
  // One room for this stay in the call.
  const room = useMemo(() => new Room(), []);
  useKeepAwake();

  // The phone's sound is set up for a conversation while the person is in the call, and given back after.
  useEffect(() => {
    void AudioSession.startAudioSession().catch(() => {});
    return () => {
      void AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  // The newest handler, without listening anew each time the screen around this redraws.
  const lost = useRef(onLost);
  useEffect(() => {
    lost.current = onLost;
  });
  useEffect(() => {
    const ended = (reason?: DisconnectReason) => lost.current(reason);
    room.on(RoomEvent.Disconnected, ended);
    return () => {
      room.off(RoomEvent.Disconnected, ended);
    };
  }, [room]);

  // What the video kit is handed stays the very same from one drawing to the next (this screen is drawn again
  // every second, for the clock): handed something new each time, the kit would enter the room again each time,
  // and switch the camera back on after the person had switched it off.
  const video = useMemo(() => (props.choices.camera ? { facingMode: "user" as const } : false), [props.choices.camera]);
  const problem = useRef(props.onProblem);
  useEffect(() => {
    problem.current = props.onProblem;
  });
  const failed = useCallback((error: Error) => problem.current(error.message), []);

  return (
    <LiveKitRoom room={room} serverUrl={props.pass.serverUrl} token={props.pass.token} connect audio={props.choices.microphone} video={video} onError={failed}>
      {PICTURES_ALLOWED ? null : <NoPictures />}
      <Stage words={props.words} clock={props.clock} onLeave={props.onLeave} onEndAndReport={props.onEndAndReport} onProblem={props.onProblem} />
    </LiveKitRoom>
  );
}

function Stage({ words, clock, onLeave, onEndAndReport, onProblem }: { words: Words; clock: { text: string; last: boolean }; onLeave: () => void; onEndAndReport: () => void; onProblem: (words: string) => void }) {
  const insets = useSafeAreaInsets();
  const watch = useWatch();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const others = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const connection = useConnectionState();
  const [front, setFront] = useState(true);
  const [loud, setLoud] = useState(true);
  const [turning, setTurning] = useState(false);
  // Whether the other person has been here at all: "has left" is only said of someone who came.
  const [seen, setSeen] = useState(false);
  if (others.length > 0 && !seen) setSeen(true);

  // What can be drawn: a picture that is really arriving, not one that is switched off.
  const drawn = tracks.filter(isTrackReference).filter((track) => !track.publication.isMuted && track.publication.track);
  const shared = drawn.find((track) => !track.participant.isLocal && track.source === Track.Source.ScreenShare);
  const theirs = drawn.find((track) => !track.participant.isLocal && track.source === Track.Source.Camera);
  const mine = drawn.find((track) => track.participant.isLocal && track.source === Track.Source.Camera);
  // A screen the other person shows (from the website) is shown large; the app never shares its own.
  const large = shared ?? theirs;
  const said = connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting ? words.reconnecting : others.length === 0 ? (seen ? words.left : words.notJoined) : shared ? words.sharing : !theirs ? words.otherCameraOff : null;

  async function microphone() {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => onProblem(words.microphoneRefused));
  }
  async function camera() {
    await localParticipant.setCameraEnabled(!isCameraEnabled, { facingMode: front ? "user" : "environment" }).catch(() => onProblem(words.cameraRefused));
  }
  async function turn() {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track || turning) return;
    setTurning(true);
    await track
      .restartTrack({ facingMode: front ? "environment" : "user" })
      .then(() => setFront(!front))
      .catch(() => {});
    setTurning(false);
  }
  async function sound() {
    // An iPhone only tells "its own choice" from "the loudspeaker"; an Android phone names both.
    const want = Platform.OS === "ios" ? (loud ? "default" : "force_speaker") : loud ? "earpiece" : "speaker";
    const there = await AudioSession.getAudioOutputs().catch(() => [] as string[]);
    if (!there.includes(want)) return;
    await AudioSession.selectAudioOutput(want)
      .then(() => setLoud(!loud))
      .catch(() => {});
  }
  function endAndReport() {
    // Asked once. The question stays up whatever happens beneath it: a "yes" only counts while this call is still the screen in front.
    const still = watch();
    Alert.alert(words.endReport, words.endReportSure, [
      { text: words.endReportNo, style: "cancel" },
      {
        text: words.endReportYes,
        style: "destructive",
        onPress: () => {
          if (still()) onEndAndReport();
        },
      },
    ]);
  }

  return (
    <View style={styles.stage}>
      {/* The call's screen is dark whatever the phone's own look: the clock and battery at the top are drawn light. */}
      <StatusBar style="light" />
      {large ? <VideoTrack trackRef={large} objectFit={shared ? "contain" : "cover"} zOrder={0} style={styles.large} /> : null}
      {mine ? (
        <View style={[styles.small, { bottom: insets.bottom + 132 }]}>
          <VideoTrack trackRef={mine} objectFit="cover" mirror={front} zOrder={1} style={styles.fill} />
        </View>
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topRow}>
          <Text accessibilityRole={clock.last ? "timer" : undefined} style={[styles.clock, clock.last ? styles.clockLast : null]}>
            {clock.text}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={words.endReport} onPress={endAndReport} hitSlop={8} style={styles.report}>
            <Text style={styles.reportWords}>{words.endReport}</Text>
          </Pressable>
        </View>
        {said ? (
          <Text accessibilityLiveRegion="polite" style={styles.said}>
            {said}
          </Text>
        ) : null}
      </View>

      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        <Round icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? words.microphoneOn : words.microphoneOff} off={!isMicrophoneEnabled} onPress={() => void microphone()} />
        <Round icon={isCameraEnabled ? "videocam" : "videocam-off"} label={isCameraEnabled ? words.cameraOn : words.cameraOff} off={!isCameraEnabled} onPress={() => void camera()} />
        <Round icon="camera-reverse" label={words.turnCamera} disabled={!isCameraEnabled || turning} onPress={() => void turn()} />
        <Round icon={loud ? "volume-high" : "ear"} label={loud ? words.loudspeaker : words.earpiece} onPress={() => void sound()} />
        <Round icon="exit-outline" label={words.leave} leave onPress={onLeave} />
      </View>
    </View>
  );
}

/** One round button of the bar, with its words under it. */
function Round({ icon, label, onPress, off = false, leave = false, disabled = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; off?: boolean; leave?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled ? styles.dim : null]}>
      <View style={[styles.round, leave ? styles.roundLeave : off ? styles.roundOff : null]}>
        <Ionicons name={icon} size={24} color={off && !leave ? "#1c1917" : "#ffffff"} />
      </View>
      <Text numberOfLines={2} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#0c0a09" },
  large: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  fill: { width: "100%", height: "100%" },
  small: { position: "absolute", right: 16, width: 104, height: 152, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  top: { position: "absolute", top: 0, right: 0, left: 0, paddingHorizontal: 16, paddingBottom: 12, gap: 8, backgroundColor: "rgba(12,10,9,0.55)" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  clock: { color: "#ffffff", fontSize: type.body, fontWeight: "700", lineHeight: 22, flexShrink: 1 },
  clockLast: { fontSize: type.heading, lineHeight: 26, color: "#fecaca" },
  report: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#fca5a5" },
  reportWords: { color: "#fecaca", fontSize: type.small, fontWeight: "700", lineHeight: 20 },
  said: { color: "#ffffff", fontSize: type.body, lineHeight: 22 },
  bar: { position: "absolute", right: 0, bottom: 0, left: 0, flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start", paddingTop: 12, paddingHorizontal: 8, backgroundColor: "rgba(12,10,9,0.55)" },
  button: { flex: 1, alignItems: "center", gap: 4, minHeight: 44 },
  dim: { opacity: 0.4 },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)" },
  roundOff: { backgroundColor: "#ffffff" },
  roundLeave: { backgroundColor: "#dc2626" },
  label: { color: "#ffffff", fontSize: 12, lineHeight: 15, textAlign: "center" },
});
