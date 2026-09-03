#!/usr/bin/env node
//
// Iteration 7's measurement table, read out of the device rather than guessed.
//
//   node scripts/call-metrics.mjs            # read logcat live until Ctrl-C
//   node scripts/call-metrics.mjs saved.log  # read a captured file
//
// The app logs one line per connect and one per reply; this turns them into the
// table in docs/DESIGN.md. Nothing here talks to the app - it only reads what
// `features/call/call-metrics.ts` already emits, so the numbers are the same
// ones the device measured rather than a stopwatch held against a screen.
//
// A release build's `console.log` reaches logcat under the ReactNativeJS tag.
// If nothing appears, check that first: `adb logcat -s ReactNativeJS`.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const ADB =
  process.env.ADB ??
  `${process.env.LOCALAPPDATA ?? ""}\\Android\\Sdk\\platform-tools\\adb.exe`;

/** Every step of a connect, in the order `RealtimeSession.open()` performs it. */
const CONNECT_STEPS = [
  ["permissionMs", "microphone permission"],
  ["conversationMs", "POST /api/conversations"],
  ["microphoneMs", "getUserMedia"],
  ["offerMs", "createOffer + setLocalDescription"],
  ["iceGatheringMs", "ICE gathering"],
  ["credentialMs", "credential mint"],
  ["sdpExchangeMs", "SDP exchange with OpenAI"],
];

const connects = [];
const replies = [];

/**
 * The JSON object at the end of a `[call] <message> { ... }` line.
 *
 * Deliberately lenient about what precedes it: logcat prefixes vary by format
 * and by Android version, and a parser that insists on one of them silently
 * reports "no calls found" on a device that logged perfectly well.
 */
function payloadAfter(line, marker) {
  const at = line.indexOf(marker);
  if (at === -1) return null;

  const brace = line.indexOf("{", at + marker.length);
  if (brace === -1) return null;

  try {
    return JSON.parse(line.slice(brace));
  } catch {
    return null;
  }
}

function consume(line) {
  const connected = payloadAfter(line, "[call] call connected");
  if (connected) {
    connects.push(connected);
    return;
  }

  /**
   * ONE source of truth for the samples: the per-reply lines.
   *
   * The summary line is a human's quick read of a finished call and is
   * deliberately ignored here. An earlier version of this script counted both,
   * and a single 366ms reply was reported as two samples of 366ms - which
   * looks like corroboration and is actually the same measurement twice.
   *
   * The summary line still matches this marker, and is excluded by the guard
   * below rather than by the marker: it carries `samples` and `medianMs` and
   * has no `latencyMs`, so it parses and is then correctly ignored.
   */
  const single = payloadAfter(line, "[call] reply latency ");
  if (single && typeof single.latencyMs === "number") replies.push(single.latencyMs);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function ms(value) {
  return value === null || value === undefined ? "-" : `${value} ms`;
}

function report() {
  console.log("");

  if (connects.length === 0 && replies.length === 0) {
    console.log("No call metrics found.");
    console.log("Open the app, tap the orb, say something, tap again.");
    console.log("If a call definitely ran, check: adb logcat -s ReactNativeJS");
    return;
  }

  if (connects.length > 0) {
    const total = connects.map((c) => c.tapToRemoteAudio).filter((n) => n != null);
    const live = connects.map((c) => c.tapToLive).filter((n) => n != null);

    console.log(`Connects measured: ${connects.length}`);
    console.log(`  tap -> first audio out   ${ms(median(total))}   (median)`);
    console.log(`  tap -> data channel live ${ms(median(live))}   (median)`);
    console.log("");
    console.log("  Where the time went (median of each step):");

    for (const [key, label] of CONNECT_STEPS) {
      const values = connects.map((c) => c[key]).filter((n) => n != null);
      if (values.length === 0) continue;
      console.log(`    ${label.padEnd(34)} ${ms(median(values))}`);
    }
  }

  if (replies.length > 0) {
    console.log("");
    console.log(`Replies measured: ${replies.length}`);
    console.log(`  end of speech -> model audio  ${ms(median(replies))}   (median)`);
    console.log(
      `  fastest ${ms(Math.min(...replies))}, slowest ${ms(Math.max(...replies))}`,
    );
  }

  console.log("");
}

const [, , file] = process.argv;

const source = file
  ? createReadStream(file)
  : spawn(ADB, ["logcat", "-s", "ReactNativeJS"], { stdio: ["ignore", "pipe", "pipe"] })
      .stdout;

if (!file) {
  console.log("Reading logcat. Run a call on the device, then Ctrl-C for the table.");
}

const lines = createInterface({ input: source });
lines.on("line", consume);
lines.on("close", report);

// Ctrl-C during a live read should still print what it has.
process.on("SIGINT", () => {
  report();
  process.exit(0);
});
