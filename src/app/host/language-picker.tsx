import { HOST_LANGUAGES, MAX_LANGUAGES } from "@/lib/profiles/languages";

/**
 * The tick boxes for the languages a host can hold a call in (plans/34-host-languages.md), for
 * both profile forms. Plain HTML with no script: the list is long, so it folds away, and ticked
 * boxes are sent with the form whether it is folded or not. The line it folds behind is fixed
 * text, because without script it could not follow the ticks. No single box is marked as
 * required (that would ask for all of them): the server checks the group.
 */
export function LanguagePicker({ chosen }: { chosen: readonly string[] }) {
  return (
    // Open while nothing from the list is chosen, so a host who still has to choose sees the list without looking for it.
    <details open={!HOST_LANGUAGES.some((language) => chosen.includes(language.code))}className="rounded border border-neutral-400 px-3 py-2 text-sm" data-language-picker>
      <summary className="cursor-pointer py-1">
        Languages you can hold a call in (choose 1 to {MAX_LANGUAGES})
      </summary>
      <fieldset className="mt-2 grid grid-cols-2 gap-x-4">
        <legend className="sr-only">Languages you can hold a call in</legend>
        {HOST_LANGUAGES.map((language) => (
          <label key={language.code} className="flex min-h-9 items-center gap-2">
            <input type="checkbox" name="languages" value={language.code} defaultChecked={chosen.includes(language.code)} />
            {language.name}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
