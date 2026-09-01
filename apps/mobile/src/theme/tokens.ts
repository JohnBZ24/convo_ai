/**
 * Dark theme only, and deliberately so - this is a voice app used with the
 * screen mostly off or glanced at. There is no light palette to switch to.
 *
 * Exact values are fixed by the design; do not "improve" them without changing
 * the design doc first.
 */
export const colors = {
  background: "#202123",
  accent: "#19C37D",
  muted: "#8E8EA0",
  text: "#ECECF1",
  /** Sidebar sits slightly above the background so its edge reads without a border. */
  surface: "#2A2B32",
  /** Scrim behind the drawer. Black at 50%, not a lighter grey - the drawer must dominate. */
  scrim: "rgba(0, 0, 0, 0.5)",
  danger: "#EF4146",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  /** The transcript. Large enough to read at arm's length while talking. */
  transcript: { fontSize: 19, lineHeight: 28 },
  title: { fontSize: 17, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
} as const;

/**
 * The orb's centre, as a FRACTION of usable height (height minus safe-area
 * insets). A pixel constant would drift between the Note 8's 846dp and any
 * other device; this does not.
 */
export const ORB_CENTRE_FRACTION = 0.38;

export const ORB_BASE_DIAMETER = 132;
