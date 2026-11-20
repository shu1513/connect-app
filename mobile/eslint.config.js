// The phone app has its own lint, apart from the website's (plans/45-phone-apps/02-the-frame.md).
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", "android/*", "ios/*", ".expo/*"] }]);
