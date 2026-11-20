import { router } from "expo-router";
import { Search } from "@/hosts/search";

/**
 * The search for someone who is not signed in (plans/45-phone-apps/05-search-and-a-hosts-page.md):
 * as on the website, hosts can be looked for, and their pages read, without an account.
 */
export default function Find() {
  return <Search onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
