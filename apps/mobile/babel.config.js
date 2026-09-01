/**
 * Worklets Bundle Mode, half of it. The other half is `metro.config.js`.
 *
 * `babel-preset-expo` injects `react-native-worklets/plugin` itself, and its
 * `worklets` option is a bare boolean with no passthrough for options - so the
 * only way to hand the plugin `bundleMode: true` is to turn the preset's own
 * injection off and add the plugin by hand.
 *
 * BOTH flags are needed. `worklets: false` alone falls through to the
 * deprecated Reanimated 3 plugin, which throws under Reanimated 4.
 */
module.exports = (api) => {
  api.cache(true);

  return {
    presets: [["babel-preset-expo", { worklets: false, reanimated: false }]],
    plugins: [
      [
        "react-native-worklets/plugin",
        {
          bundleMode: true,
          importForwarding: { moduleNames: ["remend"] },
        },
      ],
    ],
  };
};
