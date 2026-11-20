import { Text } from "react-native";
import type { AppPart } from "../../../src/lib/app-door/types";
import { localTime } from "@/lib/home-rules";
import { Words } from "./pieces";

/**
 * A sentence the server sends in parts (plans/45-phone-apps/06-asking-for-a-call.md): plain words,
 * words to stress, and exact moments, which the phone writes in its own time zone.
 */
export function Sentence({ parts, soft = false, lead = "" }: { parts: AppPart[]; soft?: boolean; lead?: string }) {
  return (
    <Words soft={soft}>
      {lead}
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : "bold" in part ? (
          <Text key={index} style={{ fontWeight: "700" }}>
            {part.bold}
          </Text>
        ) : (
          localTime(part.time)
        ),
      )}
    </Words>
  );
}
