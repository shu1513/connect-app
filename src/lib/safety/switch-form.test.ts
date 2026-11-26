import { describe, expect, it, vi } from "vitest";

// The switches' own code is read with a stand-in for the database: no connection is needed for these tests.
vi.mock("@/db", async () => ({ db: {}, schema: await vi.importActual("@/db/schema") }));

import { stopSwitchesFrom } from "./switch-form";
import { switches } from "./switches";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("the founder's stop switches form", () => {
  it("the form of today sets all three, and an unticked box means off", () => {
    expect(stopSwitchesFrom(form({ hasConversationsOff: "1", requestsOff: "on", conversationsOff: "on" })).values).toEqual({ requestsOff: true, joiningOff: false, conversationsOff: true });
    expect(stopSwitchesFrom(form({ hasConversationsOff: "1" })).values).toEqual({ requestsOff: false, joiningOff: false, conversationsOff: false });
  });

  it("a form from before the box for messages existed leaves that switch alone, and does not write it into the record", () => {
    const old = stopSwitchesFrom(form({ joiningOff: "on" }));
    expect(old.values).toEqual({ requestsOff: false, joiningOff: true });
    expect("conversationsOff" in old.values).toBe(false);
    expect(old.detail).toBe("new requests on; joining calls off");
    // Not even when the box's name is sent without the field that says the form has it.
    expect("conversationsOff" in stopSwitchesFrom(form({ conversationsOff: "on" })).values).toBe(false);
  });

  it("the record says what was set", () => {
    expect(stopSwitchesFrom(form({ hasConversationsOff: "1", conversationsOff: "on" })).detail).toBe("new requests on; joining calls on; messages between hosts and customers off");
  });
});

describe("messages are on unless the founder stopped them", () => {
  /** A reader that answers every question with these rows, as the database would. */
  const readerWith = (rows: unknown[]) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) }) as unknown as Parameters<typeof switches>[0];

  it("where no switch has ever been saved, messages are on", async () => {
    expect((await switches(readerWith([]))).conversationsOff).toBe(false);
  });

  it("a saved stop is read as a stop, and a saved 'on' as on", async () => {
    expect((await switches(readerWith([{ conversationsOff: true }]))).conversationsOff).toBe(true);
    expect((await switches(readerWith([{ conversationsOff: false }]))).conversationsOff).toBe(false);
  });
});
