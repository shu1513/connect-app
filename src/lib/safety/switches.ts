/**
 * The founder's switches: "no new requests", "nobody can join a call", and memberships
 * (off, on for the hosts the founder names, or on for everyone).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type MembershipsSwitch = "off" | "named" | "everyone";
export type Switches = { requestsOff: boolean; joiningOff: boolean; memberships: MembershipsSwitch; membershipsHosts: string[] };

const asPosition = (value: string | undefined): MembershipsSwitch => (value === "named" || value === "everyone" ? value : "off");

/**
 * Code that is inside a database step of its own passes that step as the reader, so it never
 * waits for a second connection while holding the first (with every connection busy that way,
 * nothing could finish).
 */
export async function switches(reader: Pick<typeof db, "select"> = db): Promise<Switches> {
  const [row] = await reader.select().from(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
  return {
    requestsOff: row?.requestsOff ?? false,
    joiningOff: row?.joiningOff ?? false,
    memberships: asPosition(row?.memberships),
    membershipsHosts: (row?.membershipsHosts ?? "").split(",").filter(Boolean),
  };
}

/** Sets only the switches that are given; the others stay as they are. */
export async function setSwitches(values: Partial<Switches>): Promise<void> {
  const set = {
    ...(values.requestsOff !== undefined ? { requestsOff: values.requestsOff } : {}),
    ...(values.joiningOff !== undefined ? { joiningOff: values.joiningOff } : {}),
    ...(values.memberships !== undefined ? { memberships: asPosition(values.memberships) } : {}),
    ...(values.membershipsHosts !== undefined ? { membershipsHosts: [...new Set(values.membershipsHosts)].join(",") } : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(schema.siteSwitches)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: schema.siteSwitches.id, set });
}

/**
 * Are memberships on for this host? "everyone", or "named" with this host on the list. With
 * "named" and nobody on the list they are on for nobody. Every place that checks the membership
 * switch asks this, never the plain position: a host who is not covered is treated exactly as if
 * the switch were off (months that have started go on; nothing new starts and nothing renews).
 */
export async function membershipsOnFor(hostId: string, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const { memberships, membershipsHosts } = await switches(reader);
  return memberships === "everyone" || (memberships === "named" && membershipsHosts.includes(hostId));
}
