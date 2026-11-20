/**
 * Lets the Android app be built the way a store build is made (plans/45-phone-apps/02-the-frame.md,
 * decision 2).
 *
 * Stripe's kit names, for compiling only, a Google library for adding a card to Google Wallet
 * ("tap and pay"). Google does not publish that library openly, and Connect does not use it. The
 * everyday test build never looks for it; a store build checks every library the kit names, cannot
 * find this one, and stops. Leaving it out of Stripe's kit lets the store build through and
 * changes nothing the app does.
 *
 * The folder `android/` is made fresh by Expo each time, so the lines are added here, as Expo
 * makes it, and never by hand.
 */
const { withProjectBuildGradle } = require("expo/config-plugins");

const MARK = "// connect: stripe's kit in a store build";
const LINES = `
${MARK}
subprojects { sub ->
  if (sub.name == "stripe_stripe-react-native") {
    sub.configurations.configureEach { exclude group: "com.google.android.gms", module: "play-services-tapandpay" }
  }
}
`;

module.exports = function withStripeStoreBuild(config) {
  return withProjectBuildGradle(config, (made) => {
    if (made.modResults.language !== "groovy") throw new Error("stripe-store-build: the Android build file is not in the language this was written for.");
    if (!made.modResults.contents.includes(MARK)) made.modResults.contents += LINES;
    return made;
  });
};
