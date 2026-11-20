/**
 * Keeps a sign-in out of the tools' own records (plans/45-phone-apps/02-the-frame.md).
 *
 * The everyday test build has a "network inspector": it copies every request the app makes,
 * with its headers, to the code server on the developer's computer, to be looked at there. The
 * app's requests carry the sign-in in a header, so the inspector would copy the sign-in too.
 * This switches the inspector off, on both kinds of phone. A store build never has it.
 */
const { withGradleProperties, withPodfileProperties } = require("expo/config-plugins");

const NAME = "EX_DEV_CLIENT_NETWORK_INSPECTOR";

module.exports = function withQuietTestBuild(config) {
  config = withGradleProperties(config, (made) => {
    made.modResults = made.modResults.filter((line) => !(line.type === "property" && line.key === NAME));
    made.modResults.push({ type: "property", key: NAME, value: "false" });
    return made;
  });
  return withPodfileProperties(config, (made) => {
    made.modResults[NAME] = "false";
    return made;
  });
};
