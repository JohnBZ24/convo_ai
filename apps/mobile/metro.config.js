const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode");

/**
 * This file exists ONLY for Worklets Bundle Mode.
 *
 * Do NOT add `watchFolders` for the monorepo: Expo has configured Metro for pnpm
 * workspaces automatically since SDK 52, and its own migration note is to DELETE
 * those options rather than add them.
 */
const config = getDefaultConfig(__dirname);

/**
 * Babel writes each extracted worklet into `react-native-worklets/.worklets`,
 * and Metro's resolver reads them back from there. Two Windows-specific traps:
 *
 * - `require.resolve`, never `path.resolve(__dirname, "node_modules/...")`. Under
 *   pnpm the latter is the SYMLINK, while Babel writes to the realpath inside the
 *   virtual store, so the two halves would disagree about where a worklet lives.
 * - `mkdirSync` it. There is no Watchman on Windows, and Metro's Node watcher
 *   throws on a watch root that does not exist yet - which it never does on a
 *   clean checkout, because the directory is a build artefact.
 */
const workletsDir = path.join(
  path.dirname(require.resolve("react-native-worklets/package.json")),
  ".worklets",
);
fs.mkdirSync(workletsDir, { recursive: true });

module.exports = getBundleModeMetroConfig(config);
