# Delta for ascii-conversion

## Purpose

Defines how GIF frames become colored ASCII frames, how those frames render back to pixels, and the standalone player format, so the CLI and the browser converter produce identical output.

## ADDED Requirements

### Requirement: Frame sizing
The converter SHALL produce frames exactly `width` columns wide, with height equal to `round(width × sourceHeight / sourceWidth × 0.5)` rows, minimum 1, to correct for terminal cells being about twice as tall as wide.

#### Scenario: Portrait GIF at default width
- **WHEN** a 220×366 GIF is converted at width 40
- **THEN** every frame is 40 columns by 33 rows

### Requirement: Background detection
Unless background removal is disabled, the converter SHALL treat the most common color along the border pixels of all frames as the background color.

#### Scenario: Solid white background
- **WHEN** a GIF has a near-white background touching every edge and a dark subject in the middle
- **THEN** the detected background is within 8 of white on each RGB channel

### Requirement: Character selection with background removal
With background removal on, a pixel whose RGB distance from the background is below the threshold (default 40) SHALL become a space; any other pixel SHALL get a non-space ramp character (` .:-=+*#%@`) that is denser the farther it is from the background, reaching `@` at distance 180.

#### Scenario: Background pixel
- **WHEN** a pixel is within the threshold of the background color
- **THEN** it renders as a space with no color code

#### Scenario: Strong subject pixel
- **WHEN** a pixel is 180 or more from the background color
- **THEN** it renders as `@`

### Requirement: Character selection without background removal
With background removal off, each pixel SHALL get the ramp character indexed by its luminance (`0.2126R + 0.7152G + 0.0722B`), so brighter pixels get denser characters.

#### Scenario: White pixel, background kept
- **WHEN** background removal is off and a pixel is pure white
- **THEN** it renders as `@`

### Requirement: Colored ANSI frames
Each non-space character SHALL carry its pixel's 24-bit color as an ANSI `38;2;R;G;B` escape, emitted only when the color changes within a line, and every line SHALL end with a reset.

#### Scenario: Run of identical colors
- **WHEN** three adjacent non-space pixels share one color
- **THEN** one color escape precedes all three characters

### Requirement: Glyph rendering
Rendering frames to pixels SHALL draw each ramp character as a fixed 6×12 bitmap in its ANSI color. The background SHALL be fully transparent by default or a solid hex color when given. Margin and scale belong to the exporter: the CLI's are in "CLI pixel export", the browser's in the web-converter "Exports" requirement.

#### Scenario: Transparent export
- **WHEN** frames are rendered with the default background
- **THEN** every pixel not covered by a glyph is fully transparent and every glyph pixel is fully opaque

#### Scenario: Unknown character
- **WHEN** a frame contains a character with no glyph
- **THEN** rendering fails with an error naming the character

### Requirement: CLI pixel export
`ascii2gif.mjs` SHALL surround the glyph grid with a one-cell margin and scale the result by an integer factor (1–8, default 2) using nearest-neighbor.

#### Scenario: CLI scale
- **WHEN** `ascii2gif.mjs` is run with `--scale 3`
- **THEN** each glyph pixel becomes a 3×3 block and the grid has a one-cell margin on every side

### Requirement: Standalone player format
The player SHALL be a single ES module that contains its frames and frame delay, needs only Node, loops at the source frame rate in the terminal's alternate screen with the cursor hidden, and restores the terminal on exit or Ctrl-C.

#### Scenario: Player round trip
- **WHEN** a player produced by the CLI or the site is rendered back to a GIF
- **THEN** the GIF has the same frame count and frame rate as the player

### Requirement: CLI and site parity
The CLI and the browser converter SHALL produce byte-identical player files for the same source frames and options. Both SHALL emit one frame per GIF frame and SHALL derive the player delay with one shared rule: the average of the GIF's per-frame delays, with a frame that has no graphic control extension counted as 0 ms and delays under 20 ms counted as 100 ms, clamped to 1–60 fps. A GIF with a frame outside its screen SHALL be refused by both, so neither emits fewer frames than the GIF has.

#### Scenario: Frame outside the screen
- **WHEN** a GIF has a frame that lies wholly outside its screen
- **THEN** the site refuses it and the CLI exits with an error instead of writing a player

#### Scenario: Same input, same player
- **WHEN** the same decoded frames are converted with the same width and background options by the CLI code path and the site code path
- **THEN** the generated player text is identical

#### Scenario: Frames without a graphic control extension
- **WHEN** a 4-frame GIF has a 500 ms graphic control extension on its first frame only and is converted by the CLI and by the site
- **THEN** both players have a 200 ms delay, (500 + 3 × 100) / 4

#### Scenario: Frame rate other than 10 fps
- **WHEN** a 12-frame GIF at 15 fps is converted by the CLI and by the site
- **THEN** both players have 12 frames and the same delay
