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

/**
 * WATCHING it is the other half, and the half that is easy to miss.
 *
 * Babel writes these files DURING the transform, so they do not exist when Metro
 * builds its file map. Anything outside a watch root is unknown to that map, and
 * the dev server fails the moment it tries to hash one:
 *
 *   Error: Failed to get the SHA-1 for: .../.worklets/16897143079449.js
 *
 * `expo export` does NOT show this - a one-shot bundle never needs the watcher -
 * so Bundle Mode can look completely working right up until the app is run on a
 * device against a dev server.
 *
 * This is the ONLY watchFolders entry that belongs here. Do not add the monorepo
 * packages: Expo has configured Metro for pnpm workspaces since SDK 52, and its
 * own migration note is to DELETE those.
 */
config.watchFolders = [...(config.watchFolders ?? []), workletsDir];

module.exports = getBundleModeMetroConfig(config);
