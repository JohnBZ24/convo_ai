import InCallManager from "react-native-incall-manager";

/**
 * Where the sound comes out, and in what audio mode.
 *
 * Android routes an audio-only WebRTC call to the EARPIECE by default, which is
 * wrong for a device sitting on a desk being talked to. Forcing the
 * loudspeaker is only half of it: the half that matters is that
 * `InCallManager.start` puts the device in `MODE_IN_COMMUNICATION` and takes
 * audio focus, and the mode the microphone is opened in is what decides whether
 * the hardware echo canceller is engaged.
 *
 * Without it the model hears itself through the loudspeaker, server VAD reads
 * that as the user interrupting, and it cuts itself off mid-sentence. That
 * failure is the exit test for this iteration, and this function is what passes
 * it - which is why `begin()` runs BEFORE `getUserMedia`, not after.
 */

export function beginCallAudio(): void {
  InCallManager.start({
    media: "audio",
    /**
     * `auto` is what wires the proximity sensor to the screen. Correct for a
     * phone held to the ear; wrong here, where the whole point is speakerphone
     * - it would blank the display every time the user leaned in.
     *
     * It has a second effect that is NOT obvious and cost a debugging session:
     * it also switches off InCallManager's audio-device state machine. See
     * `setSpeakerphoneOn` below, which is the line that survives it.
     */
    auto: false,
  });

  /**
   * Records the INTENT. On its own it does not route anything here.
   *
   * `setForceSpeakerphoneOn(true)` calls `selectAudioDevice(SPEAKER_PHONE)`,
   * which begins:
   *
   *     if (device != NONE && !audioDevices.contains(device)) return;
   *
   * `start()` has just run `audioDevices.clear()`, and the only thing that
   * refills that set is `updateAudioRoute()` - which returns immediately when
   * `automatic` is false, i.e. whenever `auto: false` was passed above. So the
   * set is empty, the call bails, and the last word on routing stays the
   * `setSpeakerphoneOn(false)` that `start()` performs for `media: "audio"`.
   *
   * That is why the call came out of the EARPIECE with this line present and
   * apparently correct. It is kept because it sets `forceSpeakerOn = 1`, which
   * is what the state machine reads if anything ever does re-evaluate.
   */
  InCallManager.setForceSpeakerphoneOn(true);

  /**
   * The line that actually moves the audio to the loudspeaker.
   *
   * It goes straight to `AudioManager.setSpeakerphoneOn(true)` with no device-
   * set check, so it works with `automatic` false. It must come AFTER
   * `start()`, which sets speakerphone off for an audio call, and after the
   * force flag, so it is the last write.
   *
   * With `auto: false` nothing in InCallManager re-routes afterwards, so this
   * holds for the whole call rather than being undone a moment later.
   */
  InCallManager.setSpeakerphoneOn(true);

  InCallManager.setKeepScreenOn(true);
}

export function endCallAudio(): void {
  InCallManager.setKeepScreenOn(false);
  /**
   * Clears the force flag. What actually restores the route is `stop()`, which
   * calls `restoreOriginalAudioSetup()` and puts back the speakerphone state
   * the device had before `start()` - so the phone returns to whatever it was
   * doing rather than being forced to earpiece by us.
   *
   * Deliberately NOT a `setSpeakerphoneOn(false)` to mirror `begin()`: that
   * would leave a device that was already on speaker turned off.
   */
  InCallManager.setForceSpeakerphoneOn(false);
  InCallManager.stop();
}
