/**
 * What the phone app says it showed before a person agreed to legal documents
 * (plans/46-agreements-live.md, decision 7): `agreements: [{ name, version }, ...]`, as the server
 * gave them. Anything else is read as nothing shown, and then nothing is written.
 */
import type { Shown } from "@/legal/accept";
import { isDocumentName } from "@/legal/versions";

export function shownFrom(sent: unknown): Shown {
  const shown: Shown = {};
  if (!Array.isArray(sent)) return shown;
  for (const one of sent) {
    if (one === null || typeof one !== "object") continue;
    const { name, version } = one as { name?: unknown; version?: unknown };
    if (typeof name === "string" && typeof version === "string" && isDocumentName(name)) shown[name] = version;
  }
  return shown;
}
