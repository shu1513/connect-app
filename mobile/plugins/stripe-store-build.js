/**
 * Lets the Android app be built the way a store build is made (plans/45-phone-apps/02-the-frame.md,
 * decision 2). Stripe's kit can add a card to Google Wallet ("tap and pay"). Connect does not use
 * that, and its two leftovers stop a store build, each at a different step:
 *
 * 1. Stripe's kit names, for compiling only, a Google library that Google does not publish
 *    openly. The everyday test build never looks for it; a store build checks every library the
 *    kit names, cannot find this one, and stops. It is left out of Stripe's kit.
 * 2. The step that makes a store build smaller finds Stripe's code for that feature pointing at
 *    parts that are not there (Stripe leaves them out unless an app asks for them) and stops. It
 *    is told that these are missing on purpose. This is the rule Stripe's own notes give.
 *
 * Neither changes anything the app does. The folder `android/` is made fresh by Expo each time,
 * so the lines are added here, as Expo makes it, and never by hand.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod, withProjectBuildGradle } = require("expo/config-plugins");

const MARK = "connect: stripe's kit in a store build";
const BUILD_LINES = `
// ${MARK}
subprojects { sub ->
  if (sub.name == "stripe_stripe-react-native") {
    sub.configurations.configureEach { exclude group: "com.google.android.gms", module: "play-services-tapandpay" }
  }
}
`;
const SHRINK_LINES = `
# ${MARK}
-dontwarn com.stripe.android.pushProvisioning.**
`;

module.exports = function withStripeStoreBuild(config) {
  config = withProjectBuildGradle(config, (made) => {
    if (made.modResults.language !== "groovy") throw new Error("stripe-store-build: the Android build file is not in the language this was written for.");
    if (!made.modResults.contents.includes(MARK)) made.modResults.contents += BUILD_LINES;
    return made;
  });
  return withDangerousMod(config, [
    "android",
    (made) => {
      const rules = path.join(made.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const now = fs.readFileSync(rules, "utf8");
      if (!now.includes(MARK)) fs.writeFileSync(rules, now + SHRINK_LINES);
      return made;
    },
  ]);
};
