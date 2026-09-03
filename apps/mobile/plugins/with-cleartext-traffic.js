const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

/**
 * Allow plain HTTP, so a RELEASE build can reach the dev API over the LAN.
 *
 * Android blocks cleartext from API 28 up. Expo's DEBUG manifest already sets
 * `usesCleartextTraffic="true"`, which is why the dev build talks to
 * `http://<laptop>:3000` happily and a release build built from the same source
 * silently cannot - every request fails with a network error that looks exactly
 * like the server being down.
 *
 * A release build is what makes the demo start instantly: the JS bundle is
 * embedded, so tapping the icon does not go looking for Metro. This is the one
 * thing that build needs which the debug build got for free.
 *
 * Written as a local plugin rather than pulling in `expo-build-properties`,
 * which is a whole package for this one attribute - `@expo/config-plugins` is
 * already here as part of Expo.
 *
 * SCOPE: this is a DEMO build against a dev server on a trusted network. A real
 * release must not ship with this - point the app at HTTPS and delete the
 * plugin line from app.json.
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      modConfig.modResults,
    );

    application.$["android:usesCleartextTraffic"] = "true";

    return modConfig;
  });
};
