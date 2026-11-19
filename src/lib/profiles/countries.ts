/**
 * Where a host can be based (plans/27-hosts-abroad.md). No database and no network.
 *
 * The list is every country Stripe lets Connect, a US business, pay without asking Stripe first:
 * the United States, the United Kingdom, Canada, Switzerland, and the European Economic Area
 * without Iceland (which Stripe's own table leaves out). A host in any other country cannot be
 * paid, so they cannot apply. Taking a country out of this list stops new hosts from there
 * applying; it does not switch off hosts from there who already have a profile.
 *
 * Customers can be anywhere. This list is about hosts only.
 */
export const HOST_COUNTRIES = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "CA", name: "Canada" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
] as const;

/** The country every host was in before hosts abroad existed, and the one whose payout account is asked for as it always was. */
export const HOME_COUNTRY = "US";

/** Whether a host can be based there. The code is taken exactly as written: two capital letters. */
export function isHostCountry(code: string): boolean {
  return HOST_COUNTRIES.some((country) => country.code === code);
}

/** The country's name in English, or the code itself for one that is not in the list (a country taken out later). */
export function hostCountryName(code: string): string {
  return HOST_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}
