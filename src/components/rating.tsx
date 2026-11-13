import { averageText, type ShownAverage } from "@/lib/ratings/rules";

/** A person's average, written out: "★ 4.8 from 21 ratings", or "New". Never one particular rating. */
export function Rating({ shown, newText = "New" }: { shown: ShownAverage | null; newText?: string }) {
  if (!shown) return <span className="opacity-70">{newText}</span>;
  return (
    <span>
      <span aria-hidden>★ </span>
      {averageText(shown)}
    </span>
  );
}
