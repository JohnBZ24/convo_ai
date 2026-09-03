const { withGradleProperties } = require("@expo/config-plugins");

/**
 * Build native code for arm64 only.
 *
 * Expo's default is `armeabi-v7a,arm64-v8a,x86,x86_64`, and a RELEASE build
 * compiles every one of them - including the NDK pass over
 * `react-native-worklets`, which this project builds from source for Bundle
 * Mode. That is four times the slowest part of the build to produce three
 * slices no real device here will ever load: the Note 8 reports
 * `arm64-v8a,armeabi-v7a,armeabi`, and every Android phone worth demoing on has
 * been arm64 for years. The x86 slices exist for emulators.
 *
 * Debug builds were never slow enough to notice because Gradle only builds the
 * ABI it is installing to.
 *
 * If you ever need an emulator build, override it for that run without touching
 * this file:
 *
 *   ./gradlew assembleRelease -PreactNativeArchitectures=x86_64
 */
const DEVICE_ABI = "arm64-v8a";

module.exports = function withDeviceAbi(config) {
  return withGradleProperties(config, (modConfig) => {
    const properties = modConfig.modResults.filter(
      (item) => !(item.type === "property" && item.key === "reactNativeArchitectures"),
    );

    properties.push({
      type: "property",
      key: "reactNativeArchitectures",
      value: DEVICE_ABI,
    });

    modConfig.modResults = properties;
    return modConfig;
  });
};
