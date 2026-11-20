/**
 * The app's bundler settings. One thing only: besides its own folder, the app reads two folders of
 * the website as they are, never copied (plans/45-phone-apps/04-the-home-page.md, decision 3):
 * the plain rules of the home page and its calendar (`src/lib/home`: which day a moment falls on,
 * how calls are laid out), and the shapes of the server's answers (`src/lib/app-door/types.ts`).
 * Both are plain files that need nothing a phone lacks.
 */
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../src/lib/home"), path.resolve(__dirname, "../src/lib/app-door")];

// Those files live outside this folder; whatever the bundler adds to them (its own small helpers) is found among the app's libraries.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.resolve(__dirname, "node_modules")];

module.exports = config;
