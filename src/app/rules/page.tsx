import { RULES } from "@/lib/terms";

/** The rules of the site. Everyone accepts them at sign-up, and they are linked from every call page. */
export default function RulesPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">The rules</h1>
      <p className="mt-4 text-sm">
        Connect is for conversation: advice, coaching, or a chat with someone you follow, on a private one-to-one video call.
        To keep it safe for everyone, these things are not allowed:
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
        {RULES.map((rule) => (
          <li key={rule.key}>
            <strong>{rule.title}.</strong> {rule.text}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        Talking about relationships or health is fine. If someone breaks these rules, end the call with the &quot;End call and report&quot;
        button and tell us what happened. Breaking them can mean a warning, a paused account, or a closed account.
      </p>
      <p className="mt-6 text-sm opacity-70">This page will be reviewed by a lawyer before the app opens to the public.</p>
    </main>
  );
}
