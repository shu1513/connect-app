import { registerGlobals } from "@livekit/react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { DisconnectReason } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppCallLive, AppEnded, AppPass, AppRoom } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { sameId } from "@/lib/book-rules";
import { PLAIN_HTTP_ALLOWED } from "@/lib/config";
import { useWatch } from "@/lib/here";
import { useOpening } from "@/lib/opening";
import { clockLine, isEnded, isLive, isPass, isRoom, laterEnd, notTheMoment } from "@/lib/room-rules";
import { InCall } from "@/room/in-call";
import { Lobby } from "@/room/lobby";
import { BackLink, Button, Card, Loading, Notice, Page, Words } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

// The video kit's parts must be in place before anything of it is used. Once for the app's whole run.
registerGlobals();

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * The call itself (plans/45-phone-apps/09-the-call.md): the check before entering, the call, and
 * its end. It is the same room the website enters: one person can be here and the other there.
 *
 * Nothing about who may enter is decided here. The app asks the server for an entry pass, and
 * the server's one join check answers (only a person of this call, only while the room is open
 * and, for a paid call, the money is held). Nothing about time or money is decided here either:
 * the clock on this screen follows the server's, and what is charged is counted by the server
 * from the video service's own messages.
 */
export default function RoomScreen() {
  const { id: given } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = sameId(given);
  // A screen of its own for each call.
  return <OneRoom key={id} id={id} />;
}

function OneRoom({ id }: { id: string }) {
  const colors = useColors();
  const watch = useWatch();
  const { refresh: askOpening } = useOpening();
  const [room, setRoom] = useState<AppRoom | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  /** The entry pass while the person is in the call; null before, after, and whenever they are out of the room. */
  const [pass, setPass] = useState<AppPass | null>(null);
  /**
   * What the camera check on the screen says right now: the one place the choice lives. The call enters with
   * exactly this (nothing is copied when the pass arrives), so a camera or microphone switched off at any moment
   * the camera check can still be pressed is off in the call. Both off until a camera check has said otherwise.
   */
  const [choices, setChoices] = useState({ camera: false, microphone: false });
  const noteChoice = useCallback((wanted: { camera: boolean; microphone: boolean }) => {
    setChoices((was) => (was.camera === wanted.camera && was.microphone === wanted.microphone ? was : wanted));
  }, []);
  /**
   * Counts the camera checks that have left the screen. A "Join" belongs to the camera check it was pressed on:
   * if that one is gone when the pass arrives (the screen was left, or showed something else for a moment),
   * the pass is not used, and entering takes a fresh press on the camera check that is there now.
   */
  const lobbiesLeft = useRef(0);
  const lobbyLeft = useCallback(() => {
    lobbiesLeft.current++;
  }, []);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  /** "End call now": the person is out at once, whatever happens next; if it could not be ended for both, that is said, with a way to try again. */
  const [ending, setEnding] = useState<"no" | "busy" | "failed">("no");
  const [live, setLive] = useState<AppCallLive | null>(null);
  /** The end this screen has asked the server about one last time. The call only ends on the screen once that is done. */
  const [checkedEnd, setCheckedEnd] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [inFront, setInFront] = useState(false);
  /** The same, for an answer that arrives later to ask: is this screen still the one in front? */
  const front = useRef(false);
  /** Which visit to this screen this is. What began in an earlier visit (a question, a wait) is not used in a later one, even if the person is back. */
  const visit = useRef(0);
  /** "End call now" is being sent: a second press does not send it twice. */
  const endingNow = useRef(false);
  /** The sentences of "End call now", kept from the moment it was pressed: they are still needed if the room can no longer be read (a paused account, say). */
  const [endWords, setEndWords] = useState<{ ending: string; endFailed: string; tryAgain: string } | null>(null);
  /** The end the server is being asked about one last time (see "When the clock reaches the end" below). */
  const lastCheck = useRef<number | null>(null);
  /** The connection was lost, and the server is being asked where the call stands: nothing is offered until it has answered ("failed": it could not be asked). */
  const [checking, setChecking] = useState<"no" | "asking" | "failed">("no");
  /** The same, to read where the screen comes back in front; and the newest way of asking, for that moment. */
  const checkingNow = useRef<"no" | "asking" | "failed">("no");
  const markChecking = useCallback((value: "no" | "asking" | "failed") => {
    checkingNow.current = value;
    setChecking(value);
  }, []);
  const whereItStands = useRef<() => Promise<void>>(async () => {});
  /** "End call now" went through: the screen with the three choices (report, block, neither) is opened, now or when the person is back on this screen. */
  const [toEnded, setToEnded] = useState(false);
  // The same when the OTHER person pressed it while this one was in the call, or had been in it on this screen
  // (plans/51, decision 25): once the server says the call was ended for both, on to the three choices.
  const entered = useRef(false);
  const endedForBoth = Boolean(live?.safetyEnded && !live.cancelled);
  useEffect(() => {
    if (endedForBoth && entered.current && ending === "no") setToEnded(true);
  }, [endedForBoth, ending]);
  const newest = useRef(0);
  const joiningNow = useRef(false);
  const path = `/api/app/calls/${id}`;

  // "Now" is the server's clock, carried on by a steady counter of the phone's: changing the phone's own clock
  // does not move it. It is set from every answer that brings the server's time.
  const clock = useRef<{ server: number; at: number; asked: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  /** `at`: when the answer came in; `asked`: when its question was put. The answer to the question put last sets the clock: one that was long on its way does not set it back. */
  const setClock = useCallback((serverNow: string, at = performance.now(), asked = at) => {
    const server = Date.parse(serverNow);
    if (!Number.isFinite(server)) return;
    if (clock.current && asked < clock.current.asked) return;
    clock.current = { server, at, asked };
    setNow(server + performance.now() - at);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (clock.current) setNow(clock.current.server + performance.now() - clock.current.at);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // The call's end as far as this screen knows. It only ever moves later (when time is added).
  const knownEnd = useRef(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const followEnd = useCallback((said: string) => {
    const end = laterEnd(knownEnd.current, said);
    if (end === knownEnd.current) return;
    knownEnd.current = end;
    setEndsAt(end);
  }, []);

  /** What the screen needs before anyone enters. */
  const load = useCallback(async () => {
    if (!id) {
      setGone(true);
      return;
    }
    const mine = ++newest.current;
    const askedAt = performance.now();
    const answer = await ask<AppRoom>(`${path}/room`);
    if (mine !== newest.current) return;
    if (answer.ok && isRoom(answer.data) && answer.data.id === id) {
      setRoom(answer.data);
      setClock(answer.data.serverNow, performance.now(), askedAt);
      followEnd(answer.data.endsAt);
      setProblem(null);
      setGone(false);
    } else if (!answer.ok && answer.code === "not_found") {
      setRoom(null);
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Not for this person as things stand (paused, signed out, this copy too old): the sentence, and the opening question says where they belong.
      setRoom(null);
      setGone(false);
      setProblem(answer.message);
      if (answer.code !== "paused") void askOpening();
    } else {
      setGone(false);
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [id, path, setClock, followEnd, askOpening]);

  // While the screen is in front. Leaving it, by any way, leaves the call: nobody is on camera with another screen in front.
  useFocusEffect(
    useCallback(() => {
      setInFront(true);
      front.current = true;
      visit.current++;
      void load();
      // The question "where does the call stand?" was still open when the person left: it is put again for this
      // visit. (Its old answer, if it still comes, is not used.) Until it is answered nothing is offered.
      if (checkingNow.current === "asking") void whereItStands.current();
      return () => {
        setInFront(false);
        front.current = false;
        newest.current++;
        setPass(null);
        // The last question about the end is put again when the screen is back in front.
        lastCheck.current = null;
      };
    }, [load]),
  );

  // --- Where the call stands, asked near its end and after a lost connection -------------------
  // Answers can arrive out of order: one asked before an answer already on the screen is not used.
  const asked = useRef(0);
  const shown = useRef(0);
  const refresh = useCallback(async (): Promise<AppCallLive | null> => {
    const order = ++asked.current;
    const sentAt = performance.now();
    const during = visit.current;
    const answer = await ask<AppCallLive>(`${path}/live`);
    const receivedAt = performance.now();
    if (!answer.ok || !isLive(answer.data)) return null;
    // An answer that arrives after the person has left this screen changes nothing on it, also if they are back by now.
    if (order < shown.current || !front.current || during !== visit.current) return answer.data;
    shown.current = order;
    // A quick answer is also the best reading of the server's clock there is.
    if (receivedAt - sentAt < 1_000) setClock(answer.data.serverNow, receivedAt, sentAt);
    setLive(answer.data);
    followEnd(answer.data.endsAt);
    return answer.data;
  }, [path, setClock, followEnd]);

  const opensAt = room ? Date.parse(room.opensAt) : 0;
  const startsAt = room ? Date.parse(room.startsAt) : 0;
  const watching = inFront && room !== null && now !== null && endsAt !== null && now >= opensAt && now < endsAt && endsAt - now <= room.watchSeconds * 1000;
  const askEvery = room?.askEverySeconds ?? 2;
  useEffect(() => {
    if (!watching) return undefined;
    // Now (as soon as this has been drawn), and then at the server's pace.
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), askEvery * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [watching, askEvery, refresh]);

  // When the clock reaches the end, the server is asked once more before the call ends on the screen: time may have
  // been added a moment ago, and a slow connection must not cut anyone off from that. A server that cannot be
  // reached is asked again for half a minute; only then is the call taken to be over.
  const timeUp = inFront && now !== null && endsAt !== null && now >= endsAt;
  useEffect(() => {
    if (!timeUp || endsAt === null || lastCheck.current === endsAt) return;
    lastCheck.current = endsAt;
    const checking = endsAt;
    void (async () => {
      // By the phone's steady counter, so changing the phone's clock cannot stretch or cut the half minute. Only
      // while the screen is in front: left alone, it stops, and is begun afresh when the person comes back.
      const giveUpAt = performance.now() + 30_000;
      const during = visit.current;
      const here = () => front.current && during === visit.current;
      let answered = false;
      while (here() && !answered && performance.now() < giveUpAt) {
        // Each question has only the time that is left of the half minute: one that gets no answer does not hold
        // the screen past it.
        answered = (await Promise.race([refresh(), wait(Math.max(giveUpAt - performance.now(), 0)).then(() => null)])) !== null;
        if (!answered && here()) await wait(1_500);
      }
      if (here()) setCheckedEnd(checking);
    })();
  }, [timeUp, endsAt, refresh]);

  /** Asks for an entry pass, and enters with what was chosen. */
  async function join() {
    if (joiningNow.current) return;
    joiningNow.current = true;
    const still = watch();
    const pressedOn = lobbiesLeft.current;
    setJoining(true);
    setNotice(null);
    setLeft(false);
    const askedAt = performance.now();
    const answer = await ask<AppPass>(`${path}/enter`, { body: {} });
    const receivedAt = performance.now();
    joiningNow.current = false;
    setJoining(false);
    // The person left this screen while the pass was on its way: nothing is entered, and nothing of it is used.
    if (!still()) return;
    // The camera check this was pressed on is no longer the one on the screen: this answer belongs to it, not to
    // what is on the screen now. Nothing is entered (that takes a fresh press) and nothing is said (a refusal or a
    // failure of the old press is not shown on a new camera check). One thing is kept: a later end of the call,
    // if a pass brings one (time was added), so the screen does not take the call for over. Its clock is not
    // taken: it was read before the moment this screen has already reached.
    if (pressedOn !== lobbiesLeft.current) {
      if (answer.ok && isPass(answer.data, { plain: PLAIN_HTTP_ALLOWED })) followEnd(answer.data.endsAt);
      return;
    }
    if (answer.ok && isPass(answer.data, { plain: PLAIN_HTTP_ALLOWED })) {
      // The pass carries the server's clock and the call's end as they are now (time may have been added since).
      setClock(answer.data.serverNow, receivedAt, askedAt);
      followEnd(answer.data.endsAt);
      // (Entered with `choices` as the camera check says them at the moment the call is drawn.)
      entered.current = true;
      setPass(answer.data);
    } else if (!answer.ok && answer.code === "not_found") {
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Refused, in the server's own sentence (not open yet, over, not paid, calls paused across Connect, a paused account).
      setNotice(answer.message);
      if (answer.code !== "not_valid" && answer.code !== "switched_off" && answer.code !== "paused") void askOpening();
    } else {
      setNotice(answer.ok ? UNREACHABLE : answer.message);
    }
  }

  /** After a lost connection: the server is asked where the call stands. Without its answer nothing is offered but to ask again. */
  const askWhereItStands = useCallback(async () => {
    const during = visit.current;
    markChecking("asking");
    const answer = await refresh();
    // The person left this screen meanwhile: this answer decides nothing, also if they are back by now. The visit
    // they are on asks for itself (where the screen comes in front), and until then nothing is offered.
    if (!front.current || during !== visit.current) return;
    if (!answer) {
      markChecking("failed");
      return;
    }
    markChecking("no");
    if (room) setNotice(room.words.disconnected);
  }, [refresh, room, markChecking]);
  useEffect(() => {
    whereItStands.current = askWhereItStands;
  }, [askWhereItStands]);

  /** The connection ended without the person leaving. */
  const lost = useCallback(
    (reason?: DisconnectReason) => {
      setPass(null);
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) setTakenOver(true);
      else if (reason !== DisconnectReason.CLIENT_INITIATED) {
        // The call may have been stopped by the other person, or its time may be up: the server is asked first,
        // and until it has answered nothing is offered (not "join again", and not the camera check).
        void askWhereItStands();
      }
    },
    [askWhereItStands],
  );

  function leave() {
    setNotice(null);
    setLeft(true);
    setPass(null);
  }

  async function endNow() {
    if (endingNow.current) return;
    endingNow.current = true;
    if (room) setEndWords({ ending: room.words.ending, endFailed: room.words.endFailed, tryAgain: room.words.tryAgain });
    setEnding("busy");
    // Out of the room at once, on this phone, whatever happens next.
    setPass(null);
    const answer = await ask<AppEnded>(`${path}/end-now`, { body: {} });
    endingNow.current = false;
    if (answer.ok && isEnded(answer.data)) {
      setEnding("no");
      // On to the three choices: now, or (if the person has gone to another screen meanwhile) when they are back on this one.
      setToEnded(true);
    } else if (!answer.ok && answer.code === "not_valid") {
      // "This call has not started yet": nothing to end.
      setEnding("no");
      setNotice(answer.message);
    } else {
      setEnding("failed");
    }
  }

  const toCall = useCallback(() => router.replace({ pathname: "/calls/[id]", params: { id } }), [id]);
  const back = () => (router.canGoBack() ? router.back() : toCall());

  // Not the moment for this screen (not open yet, unpaid, cancelled, over when it was opened, or the call's two
  // people may no longer act): the call's own page says which, and leads here again when the room is open. Whenever
  // there is no entry pass, the server's newest "not ready" wins, also for someone who was here before and comes back.
  const notNow = room !== null && now !== null && notTheMoment({ ready: room.ready, opensAt, now, endsAt, inCall: pass !== null, live });
  useEffect(() => {
    if (toEnded && inFront) router.replace({ pathname: "/ended", params: { call: id } });
    else if (notNow && inFront && ending === "no") toCall();
  }, [toEnded, notNow, inFront, ending, toCall, id]);

  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no call here, or it is not yours.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  // "End call now" comes before everything else, also before a room that can no longer be read (a paused
  // account can still end its call): until it is known that the call is ended for both, the way to try again must
  // not be hidden by anything.
  if (inFront && endWords && (ending === "busy" || toEnded)) return <Loading words={endWords.ending} />;
  if (inFront && endWords && ending === "failed") {
    return (
      <Page>
        <Notice>{endWords.endFailed}</Notice>
        <Button label={endWords.tryAgain} kind="danger" onPress={() => void endNow()} />
      </Page>
    );
  }
  if (!room || now === null || endsAt === null) {
    if (!problem) return <Loading />;
    // This screen has no bar at the top to go back with: beside "Try again" there is always a way out.
    return (
      <Page>
        <Notice>{problem}</Notice>
        <Button label="Try again" onPress={() => void load()} />
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  const words = room.words;

  // With another screen in front, nothing of the call is drawn here at all: no camera check (which would switch
  // the camera on behind that screen), and no call.
  if (!inFront) return <View style={styles.fill} />;

  // Over on the screen only once the server has confirmed this end, or said the call was stopped.
  if ((now >= endsAt && checkedEnd === endsAt) || live?.cancelled || live?.safetyEnded) {
    return (
      <Page>
        <Words>{words.ended}</Words>
        {/* Ended by one of the two with "End call now": on to who ended it and "Report", "Block", "Neither". Otherwise the call's page. */}
        <Button label={words.results} onPress={live?.safetyEnded && !live.cancelled ? () => router.replace({ pathname: "/ended", params: { call: id } }) : toCall} />
      </Page>
    );
  }
  // The clock has reached the end and the server is being asked one last time. Someone in the call stays in it
  // for that moment; anyone else waits for the answer.
  if (now >= endsAt && !pass) return <Loading words={words.oneMoment} />;
  if (notNow) return <Loading />;
  if (checking === "asking") return <Loading words={words.oneMoment} />;
  if (checking === "failed") {
    // The server could not be asked where the call stands. The camera check is not offered on a guess: only asking again is.
    return (
      <Page>
        <Notice>{UNREACHABLE}</Notice>
        <Button label={words.tryAgain} onPress={() => void askWhereItStands()} />
        <Button label={words.backToCall} kind="plain" onPress={toCall} />
      </Page>
    );
  }

  if (takenOver) {
    return (
      <Page>
        <Words>{words.takenOver}</Words>
        <Words soft>{words.takenOverSmall}</Words>
        <Button label={words.useThisPhone} onPress={() => setTakenOver(false)} />
      </Page>
    );
  }
  const line = clockLine(words, { now, startsAt, endsAt, countdownSeconds: room.countdownSeconds });
  if (pass) {
    return (
      <View style={styles.fill}>
        <InCall key={pass.token} pass={pass} choices={choices} words={words} clock={line} onLost={lost} onLeave={leave} early={now < startsAt} onEndNow={() => void endNow()} onProblem={setNotice} />
        {notice ? (
          <View style={styles.over} pointerEvents="box-none">
            <Pressable accessibilityRole="alert" accessibilityLabel={notice} onPress={() => setNotice(null)} style={[styles.overNotice, { backgroundColor: colors.notice, borderColor: colors.noticeLine }]}>
              <Text style={[styles.overWords, { color: colors.text }]}>{notice}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Page>
      <BackLink onBack={toCall} />
      <Text accessibilityRole={line.last ? "timer" : "header"} style={[styles.clock, { color: line.last ? colors.danger : colors.text }]}>
        {line.text}
      </Text>
      {problem ? <Notice>{problem}</Notice> : null}
      {notice ? <Notice>{notice}</Notice> : left ? <Words soft>{words.youLeft}</Words> : null}
      {room.about ? (
        // The host's private note about the customer, to read while she waits. Folded, and never drawn in the call itself.
        <Card>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: aboutOpen }} accessibilityLabel={room.about.title} onPress={() => setAboutOpen(!aboutOpen)} style={styles.fold}>
            <Text style={[styles.bold, { color: colors.text }]}>
              {aboutOpen ? "▾" : "▸"} {room.about.title}
            </Text>
          </Pressable>
          {aboutOpen ? <Words>{room.about.text}</Words> : null}
        </Card>
      ) : null}
      <Lobby words={words} joining={joining} onChoice={noteChoice} onLeft={lobbyLeft} onJoin={() => void join()} />
      <Button label={words.backToCall} kind="plain" onPress={toCall} />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clock: { fontSize: type.heading, fontWeight: "800", lineHeight: 28 },
  bold: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  fold: { minHeight: 44, justifyContent: "center" },
  over: { position: "absolute", right: 16, left: 16, top: "38%" },
  overNotice: { borderWidth: 1, borderRadius: 16, padding: 16 },
  overWords: { fontSize: type.body, lineHeight: 22 },
});
