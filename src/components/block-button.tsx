import { blockAction } from "@/app/report/actions";

/** A small "Block" button with a one-step confirmation, for a request's page and a call's page. */
export function BlockButton({ userId, name, back }: { userId: string; name: string; back: string }) {
  return (
    <form action={blockAction} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="underline underline-offset-2" title={`Block ${name}: they cannot ask you for calls any more`}>
        Block {name}
      </button>
    </form>
  );
}
