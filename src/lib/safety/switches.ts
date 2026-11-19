/**
 * The founder's switches: "no new requests", "nobody can join a call", memberships and projects
 * (each of the last two: off, on for the hosts the founder names, or on for everyone).
 *
 * Memberships are ON FOR EVERYONE unless the founder turns them off or names hosts (the founder's
 * decision, 18 November 2026). The switch is there to stop them, not to start them. Projects work
 * the same way (plans/23, choice F).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type MembershipsSwitch = "off" | "named" | "everyone";
export type Switches = { requestsOff: boolean; joiningOff: boolean; memberships: MembershipsSwitch; membershipsHosts: string[]; projects: MembershipsSwitch; projectsHosts: string[] };

/** A saved position, read strictly: anything that is not one of the three words counts as "off", the safe side. */
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
    // Before the founder has saved any switch there is no row: memberships are on for everyone then, like the column's own default.
    memberships: row ? asPosition(row.memberships) : "everyone",
    membershipsHosts: (row?.membershipsHosts ?? "").split(",").filter(Boolean),
    // The same for projects: no row yet means on for everyone, like the column's own default.
    projects: row ? asPosition(row.projects) : "everyone",
    projectsHosts: (row?.projectsHosts ?? "").split(",").filter(Boolean),
  };
}

/**
 * Sets only the switches that are given; the others stay as they are. Code that has a database
 * step of its own passes it as the writer, so that the change and whatever is recorded with it
 * are saved together or not at all.
 */
export async function setSwitches(values: Partial<Switches>, writer: Pick<typeof db, "insert"> = db): Promise<void> {
  const set = {
    ...(values.requestsOff !== undefined ? { requestsOff: values.requestsOff } : {}),
    ...(values.joiningOff !== undefined ? { joiningOff: values.joiningOff } : {}),
    ...(values.memberships !== undefined ? { memberships: asPosition(values.memberships) } : {}),
    ...(values.membershipsHosts !== undefined ? { membershipsHosts: [...new Set(values.membershipsHosts)].join(",") } : {}),
    ...(values.projects !== undefined ? { projects: asPosition(values.projects) } : {}),
    ...(values.projectsHosts !== undefined ? { projectsHosts: [...new Set(values.projectsHosts)].join(",") } : {}),
    updatedAt: new Date(),
  };
  await writer
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

/**
 * Are projects on for this host? Read exactly as memberships are: "everyone", or "named" with this
 * host on the list. While this says no she cannot start a project, write or change a post, or
 * upload; what she has written stays readable, and she can still remove a post and end her project.
 */
export async function projectsOnFor(hostId: string, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const { projects, projectsHosts } = await switches(reader);
  return projects === "everyone" || (projects === "named" && projectsHosts.includes(hostId));
}
