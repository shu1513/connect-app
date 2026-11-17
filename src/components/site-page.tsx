import Link from "next/link";
import { isAdmin } from "@/lib/payments/access";
import { getUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

/**
 * The frame of every page: the top bar, then the page itself.
 *
 * It is used by each page rather than by the one layout around all pages, on purpose: a layout is
 * not drawn again when someone moves between pages, so after logging in or out it would still show
 * the old links. Drawn with the page, the bar is always right for whoever is looking.
 *
 * `bare` is for the sign-up steps (log in, create an account, the welcome step): only the name of
 * the site, because someone in the middle of signing up cannot use the other pages yet. Two pages
 * have no frame: the live call, where a bar would invite leaving the call by accident, and the
 * visitor's front page, which draws its own top bar and footer in its own look (src/app/page.tsx).
 */
export async function SitePage({ bare = false, className, children }: { bare?: boolean; className: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader bare={bare} />
      <main className={className}>{children}</main>
      <footer className="mt-auto border-t border-neutral-400/40">
        <p className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-sm opacity-70">
          <Link href="/rules" className="underline-offset-2 hover:underline">
            Rules
          </Link>
          <Link href="/terms" className="underline-offset-2 hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
          </Link>
        </p>
      </footer>
    </>
  );
}

async function SiteHeader({ bare }: { bare: boolean }) {
  // The same look-up the page itself makes; it is done once per page view.
  const user = bare ? null : await getUser();
  const admin = user ? await isAdmin(user.id) : false;
  const link = "underline-offset-2 hover:underline";
  return (
    <header data-site-header={bare ? "bare" : user ? "member" : "visitor"} className="border-b border-neutral-400/40">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3 text-sm">
        <Link href="/" className="mr-1 text-base font-semibold">
          Connect
        </Link>
        {!bare && (
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1">
            {user && (
              <Link href="/" className={link}>
                Your calls
              </Link>
            )}
            <Link href="/search" className={link}>
              Find a host
            </Link>
            {user ? (
              <>
                <Link href="/host" className={link}>
                  Hosting
                </Link>
                <Link href="/account" className={link}>
                  Your account
                </Link>
                {admin && (
                  <Link href="/admin" className={link}>
                    Admin
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link href="/login" className={link}>
                  Log in
                </Link>
                <Link href="/signup" className={link}>
                  Create an account
                </Link>
              </>
            )}
          </nav>
        )}
        {user && (
          <p className="ml-auto">
            {user.name} · <SignOutButton />
          </p>
        )}
      </div>
    </header>
  );
}
