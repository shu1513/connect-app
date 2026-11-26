import Link from "next/link";
import { topBarCount } from "@/lib/conversations/read";
import { isAdmin } from "@/lib/payments/access";
import { getUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";
import { warm, warmFont } from "./warm-ui";

/** The legal documents, as both footers of the site link them (this one and the front page's own). The texts are in src/legal. */
export const LEGAL_LINKS = [
  { href: "/rules", words: "Rules" },
  { href: "/terms", words: "Terms" },
  { href: "/payment-terms", words: "Payment terms" },
  { href: "/privacy", words: "Privacy" },
  { href: "/host-agreement", words: "Host agreement" },
  { href: "/copyright", words: "Copyright and complaints" },
  { href: "/identity-notice", words: "Identity check" },
] as const;

/**
 * The frame of every page: the top bar, then the page itself, in the site's warm look.
 *
 * It is used by each page rather than by the one layout around all pages, on purpose: a layout is
 * not drawn again when someone moves between pages, so after logging in or out it would still show
 * the old links. Drawn with the page, the bar is always right for whoever is looking.
 *
 * `bare` is for the sign-up steps (log in, create an account, the welcome step): only the name of
 * the site, because someone in the middle of signing up cannot use the other pages yet. Two pages
 * have no frame: the live call, where a bar would invite leaving the call by accident, and the
 * visitor's front page, which draws its own top bar and footer (src/app/page.tsx).
 */
export async function SitePage({ bare = false, className, children }: { bare?: boolean; className: string; children: React.ReactNode }) {
  return (
    <div className={`${warmFont.className} ${warm.root} ${warm.page}`}>
      <SiteHeader bare={bare} />
      <main className={className}>{children}</main>
      <footer className={warm.footer}>
        <p className={warm.footerLinks}>
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="underline-offset-2 hover:underline">
              {link.words}
            </Link>
          ))}
        </p>
      </footer>
    </div>
  );
}

async function SiteHeader({ bare }: { bare: boolean }) {
  // The same look-up the page itself makes; it is done once per page view.
  const user = bare ? null : await getUser();
  const admin = user ? await isAdmin(user.id) : false;
  // What Connect has written to them and they have not been shown yet (plans/47), plus the conversations in which
  // the other person wrote something they have not been shown (plans/49). Counted per page view, like the rest of the bar.
  const unread = user ? await topBarCount(user.id) : 0;
  return (
    <header data-site-header={bare ? "bare" : user ? "member" : "visitor"} className={warm.header}>
      <div className={warm.headerInner}>
        <Link href="/" className={warm.brand}>
          Connect
        </Link>
        {!bare && (
          <nav aria-label="Main" className={warm.nav}>
            {user && (
              <Link href="/" className={warm.navLink}>
                Home
              </Link>
            )}
            <Link href="/search" className={warm.navLink}>
              Find a host
            </Link>
            {user ? (
              <>
                <Link href="/following" className={warm.navLink}>
                  Following
                </Link>
                <Link href="/host" className={warm.navLink}>
                  Hosting
                </Link>
                <Link href="/messages" className={warm.navLink} data-messages-link data-unread={unread}>
                  Messages{unread > 0 ? ` (${unread})` : ""}
                </Link>
                <Link href="/account" className={warm.navLink}>
                  Your account
                </Link>
                {admin && (
                  <Link href="/admin" className={warm.navLink}>
                    Admin
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link href="/login" className={warm.navLink}>
                  Log in
                </Link>
                <Link href="/signup" className={warm.signup}>
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
