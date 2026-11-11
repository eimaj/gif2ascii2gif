# Delta for web-converter

## Purpose

Defines the browser converter: how a visitor brings in a GIF, adjusts the conversion, previews it, downloads results, and what the page tells them about how it works, its dependencies, and their privacy.

## ADDED Requirements

### Requirement: Client-side processing
All decoding, conversion, rendering, and encoding SHALL run in the visitor's browser. The site SHALL NOT upload, proxy, or store the visitor's GIF or its URL.

#### Scenario: Local file conversion
- **WHEN** a visitor converts a local file
- **THEN** no network request carries the file's contents

### Requirement: GIF input
The page SHALL accept a GIF through a file picker, drag-and-drop onto the page, or a pasted URL fetched by the browser.

#### Scenario: Drag and drop
- **WHEN** a visitor drops a GIF file on the page
- **THEN** it is converted and the preview starts playing

#### Scenario: URL blocked by the host
- **WHEN** a pasted URL cannot be fetched because the host does not allow cross-origin requests
- **THEN** the page explains that the host blocks browser downloads and suggests saving the GIF and uploading it

#### Scenario: Not a GIF
- **WHEN** the input is not a decodable GIF
- **THEN** the page shows an error saying the file is not a readable GIF and keeps the previous result

### Requirement: Demo
The page SHALL start with no GIF loaded and offer a "Try the demo" control that loads a fixed public demo GIF by URL.

#### Scenario: Demo click
- **WHEN** a visitor clicks "Try the demo"
- **THEN** the demo GIF is fetched, converted, and playing in the preview

### Requirement: Size limits
The page SHALL refuse, without converting, a GIF with more than 300 frames or a file larger than 20 MB, and SHALL state which limit was exceeded, the actual value, and that the limit keeps the browser tab responsive.

#### Scenario: Too many frames
- **WHEN** a visitor loads a 450-frame GIF
- **THEN** no conversion runs and the page says the GIF has 450 frames, the limit is 300, and why

### Requirement: Pixel limits
The page SHALL refuse, without converting and with the same kind of message as the size limits, a GIF whose declared screen is wider or taller than 1024 pixels, any of whose frame rectangles extends past the screen, that has more than 50 megapixels across all frames (frames × screen area), or whose screen is more than 5 times taller than it is wide. They SHALL be checked from the header before any frame is decompressed; a refused screen size SHALL come with a resize hint.

#### Scenario: Tiny file declaring a huge image
- **WHEN** a visitor loads a GIF under 100 bytes whose header declares a 60000×60000 screen
- **THEN** no frame is decompressed and the page says the GIF is 60000×60000 pixels, the limit is 1024×1024, and why

#### Scenario: Full HD GIF
- **WHEN** a visitor loads a 1920×1080 GIF
- **THEN** no conversion runs and the page says the GIF is 1920×1080 pixels, the limit is 1024×1024, and suggests resizing it

#### Scenario: Frame outside the screen
- **WHEN** a visitor loads a GIF with a 16×16 screen and an 8×8 frame at 40,40
- **THEN** no conversion runs and the page says which frame extends past the screen, the screen size, and why

#### Scenario: Very tall, narrow GIF
- **WHEN** a visitor loads a 5×1000 GIF
- **THEN** no conversion runs and the page says the GIF is 200 times taller than it is wide, the limit is 5, and why

### Requirement: Compression header check
The page SHALL refuse, as not a readable GIF and before any frame is decompressed, a GIF any of whose frames declares an LZW minimum code size outside 2–8, the range the GIF format allows, since that one header byte sets the decompressor's work and memory per frame.

#### Scenario: Tiny file declaring a huge code size
- **WHEN** a visitor loads a GIF under 400 bytes whose frames declare LZW minimum code size 27
- **THEN** no frame is decompressed and the page says the file is not a readable GIF and keeps the previous result

### Requirement: Controls
The page SHALL expose width (8–160 columns, default 40), background threshold (0–179, default 40), keep background (default off), and export background (transparent by default, or a hex color). It SHALL NOT offer an export scale: the GIF export's size is the source GIF's size. Changing any control SHALL update the preview without reloading the GIF.

#### Scenario: Width change
- **WHEN** a visitor changes width from 40 to 60
- **THEN** the preview re-renders at 60 columns within the same session

#### Scenario: No scale control
- **WHEN** a visitor opens the settings
- **THEN** there is no export scale control

### Requirement: Live preview
The page SHALL play the converted frames in a looping canvas at the source frame rate, drawn with the same glyphs and settings as the GIF export, over a checkerboard when the export background is transparent.

#### Scenario: Preview matches export
- **WHEN** a visitor exports the GIF with the current settings
- **THEN** each exported frame equals the corresponding preview frame, without its one-cell margin, area-resampled to the source GIF's width and height

### Requirement: Exports
The page SHALL offer downloads of the animated GIF (looping, current settings) and the standalone terminal player (`<name>.mjs`), named after the source GIF. The GIF SHALL be exactly the source GIF's width and height, its glyphs drawn without a margin and area-resampled to that size with transparency cut at 50% alpha. When the grid is wider than the source at 6 pixels per character, the page SHALL note near the export button that characters may not be readable.

#### Scenario: Export at source size
- **WHEN** a visitor exports the 220×366 demo GIF at any width
- **THEN** the downloaded GIF is 220×366 pixels

#### Scenario: Narrow characters
- **WHEN** a visitor sets 160 columns for a 220-pixel-wide GIF
- **THEN** a note near the export button says characters are smaller than 6 pixels and may not be readable

#### Scenario: Download player
- **WHEN** a visitor downloads the player for `dance-dancing.gif`
- **THEN** the file is `dance-dancing.mjs` and running it with Node plays the animation

### Requirement: Page content
Below the converter the page SHALL show, in order: a three-step "How it works", CLI usage with copyable commands, "Credits and licenses", and a footer linking the GitHub repository.

#### Scenario: Copy CLI command
- **WHEN** a visitor activates the copy control on a CLI command
- **THEN** the exact command text is on their clipboard

### Requirement: Dependency transparency
"Credits and licenses" SHALL list every third-party library the site ships, each with its name, pinned version, project link, license name, a link to the license file served from the site, and what the site uses it for. It SHALL also credit ffmpeg as the CLI's dependency.

#### Scenario: License file served
- **WHEN** a visitor follows a library's license link
- **THEN** the full license text is served from the site itself

### Requirement: Privacy note
The page SHALL state that the GIF never leaves the browser, SHALL list exactly which anonymous usage events and fields are counted, and SHALL disclose the host's cookieless page-view analytics (Cloudflare Web Analytics, per design D7) and what it derives from each request, so the statement of what the events omit does not deny what page-view analytics collects.

#### Scenario: Privacy note matches events
- **WHEN** the set of usage events changes
- **THEN** the privacy note lists the same events and fields

### Requirement: Appearance
The page SHALL use a monospace, terminal-like style, dark by default, switching to light when the system prefers light, and SHALL work at phone width with no horizontal page scroll.

#### Scenario: Light preference
- **WHEN** the operating system prefers a light color scheme
- **THEN** the page renders in its light theme
