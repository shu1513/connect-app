import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { ContributionError, kindsOffered, readAmount } from "@/lib/contributions/rules";
import { whyNotContribute } from "@/lib/contributions/start";
import { agreementBox, CONTRIBUTION_WORDING_VERSION, summarySentences } from "@/lib/contributions/wording";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { isId } from "@/lib/projects/projects";
import { requireUser } from "@/lib/session";
import { startContributionAction } from "../actions";

export const metadata: Metadata = { title: "Contribute" };

export const dynamic = "force-dynamic";

/**
 * The summary before paying (plans/23, "Contributing once", "Contributing monthly"): what the
 * person pays and every sentence they must have read, and for a monthly contribution the box they
 * tick. Opening or reloading this page writes nothing: it only makes the id of a request. The
 * contribution is written when the form is sent.
 *
 * The address names the project, the kind and the amount as the person picked or typed them on
 * the project's page.
 */
export default async function NewContributionPage(props: PageProps<"/contributions/new">) {
  const query = await props.searchParams;
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value.slice(0, 20) : "");
  const projectId = typeof query.project === "string" && isId(query.project) ? query.project.toLowerCase() : "";
  const kind = query.kind === "monthly" ? "monthly" : "once";
  // An amount typed into the box counts before one that was picked.
  const typed = text(query.other).trim() || text(query.amount).trim();
  const user = await requireUser(`/contributions/new?project=${projectId}&kind=${kind}&amount=${encodeURIComponent(typed)}`);
  const notice = readNotice("/contributions/new", query);

  const [found] = projectId
    ? await db
        .select({ project: schema.projects, hostName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle })
        .from(schema.projects)
        .innerJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId))
        .where(eq(schema.projects.id, projectId))
    : [];
  if (!found) notFound();
  const { project, hostName, handle } = found;
  const back = `/h/${handle}/project`;

  // Asked here so that a page that cannot lead anywhere says so at once; asked again, under its locks, when the form is sent.
  let cannot = await whyNotContribute(db, { contributorId: user.id, project });
  if (!cannot && !kindsOffered(project).includes(kind)) cannot = kind === "monthly" ? "This project does not take monthly contributions at the moment." : "This project only takes monthly contributions at the moment.";
  let amountCents: number | null = null;
  let amountProblem: string | null = null;
  try {
    amountCents = readAmount(typed);
  } catch (error) {
    if (!(error instanceof ContributionError)) throw error;
    amountProblem = typed ? error.message : "Please pick or type an amount.";
  }

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href={back} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {project.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Contribute to {project.name}</h1>
      <p className="mt-1 text-sm opacity-70">A project by {hostName}.</p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {cannot ? (
        <p className="mt-6 text-sm" data-cannot>
          {cannot}
        </p>
      ) : amountCents === null ? (
        <p className="mt-6 text-sm" data-amount-problem>
          {amountProblem}{" "}
          <Link href={back} className="underline underline-offset-2">
            Choose an amount on the project&apos;s page.
          </Link>
        </p>
      ) : (
        <section className="mt-6 text-sm" data-summary>
          <p className="text-base">
            <strong>
              {formatMoney(amountCents)}
              {kind === "monthly" ? " every month" : ", once"}
            </strong>
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {summarySentences({ kind, amountCents, hostName, projectName: project.name }).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <form action={startContributionAction} className="mt-5">
            <input type="hidden" name="project" value={project.id} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="amount" value={typed} />
            {/* Made when this page was drawn: the same press, sent twice, is one contribution. */}
            <input type="hidden" name="request" value={randomUUID()} />
            <input type="hidden" name="wording" value={CONTRIBUTION_WORDING_VERSION} />
            {kind === "monthly" && (
              <label className="flex items-start gap-2">
                <input type="checkbox" name="agreed" required className="mt-1" />
                <span>{agreementBox(amountCents)}</span>
              </label>
            )}
            <button type="submit" className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white">
              Continue to the card step
            </button>
            <p className="mt-2 opacity-70">The next step asks for your card. Nothing is held until you have paid there.</p>
          </form>
        </section>
      )}
    </SitePage>
  );
}
