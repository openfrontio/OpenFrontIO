# Client reference

Table of contents:

[TOC]

## Graphics

### AnimatedSprite.ts

#### class `AnimatedSprite`

Represents a frame-based animation drawn on a canvas. Handles frame timing, looping, rendering, and origin offsets based on elapsed time.

**Properties:**

| Name            | Type                | Description                                        |
| --------------- | ------------------- | -------------------------------------------------- |
| `image`         | `CanvasImageSource` | Source image for the sprite sheet.                 |
| `frameWidth`    | `number`            | Width of a single frame in pixels.                 |
| `frameCount`    | `number`            | Number of frames in the sprite sheet.              |
| `frameDuration` | `number`            | Duration of each frame in milliseconds.            |
| `looping`       | `boolean`           | Whether the animation loops (defaults to `false`). |
| `originX`       | `number`            | Horizontal origin offset in pixels.                |
| `originY`       | `number`            | Vertical origin offset in pixels.                  |
| `frameHeight`   | `number`            | Height of each frame.                              |
| `currentFrame`  | `number`            | Index of the current frame.                        |
| `elapsedTime`   | `number`            | Accumulated time since the last frame change.      |
| `active`        | `boolean`           | Whether the animation is currently playing.        |

##### public constructor `constructor()`

| Parameter       | Type                | Description                                    |
| --------------- | ------------------- | ---------------------------------------------- |
| `image`         | `CanvasImageSource` | Source image for the sprite sheet.             |
| `frameWidth`    | `number`            | Width of a single frame in pixels.             |
| `frameCount`    | `number`            | Number of frames in the sprite sheet.          |
| `frameDuration` | `number`            | Duration of each frame in milliseconds.        |
| `looping`       | `boolean`           | Whether the animation loops (default `false`). |
| `originX`       | `number`            | Horizontal origin offset in pixels.            |
| `originY`       | `number`            | Vertical origin offset in pixels.              |

Throws an error if the `image` does not have a `height` property.

##### public function `update()`

| Parameter   | Type     | Description                        |
| ----------- | -------- | ---------------------------------- |
| `deltaTime` | `number` | Time passed since the last update. |

Updates the `currentFrame` and `active` properties based on elapsed time.

Returns `void`.

##### public function `isActive()`

Returns `boolean` — whether the animation is currently active.

##### public function `lifeTime()`

Returns `number | undefined` — total length of the animation in milliseconds or `undefined` for looping animations.

##### public function `draw()`

| Parameter | Type                       | Description               |
| --------- | -------------------------- | ------------------------- |
| `ctx`     | `CanvasRenderingContext2D` | Rendering context.        |
| `x`       | `number`                   | X-coordinate for drawing. |
| `y`       | `number`                   | Y-coordinate for drawing. |

Draws the current active frame onto `ctx` at `[x, y]` adjusted by origin offsets.

Returns `void`.

##### public function `reset()`

Resets the animation to the first frame and resets elapsed time.

Returns `void`.

##### public function `setOrigin()`

| Parameter | Type     | Description                      |
| --------- | -------- | -------------------------------- |
| `xRatio`  | `number` | New horizontal origin in pixels. |
| `yRatio`  | `number` | New vertical origin in pixels.   |

Updates the origin offsets used for drawing.

Returns `void`.

### AnimatedSpriteLoader.ts

#### class `AnimatedSpriteLoader`

Manages loading, colorizing, caching, and creation of [class `AnimatedSprite`](#class-animatedsprite) instances.

**Properties:**

| Name                         | Type                             | Description                                                |
| ---------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `animatedSpriteImageMap`     | `Map<FxType, HTMLCanvasElement>` | Stores loaded sprite images as canvases keyed by `FxType`. |
| `coloredAnimatedSpriteCache` | `Map<string, HTMLCanvasElement>` | Caches colorized canvases per owner.                       |

##### public function `loadAllAnimatedSpriteImages()`

Returns `Promise<void>`.

Loads all images referenced in `ANIMATED_SPRITE_CONFIG` into canvases. Logs an error for any failed loads.

##### private function `createRegularAnimatedSprite()`

| Parameter | Type     | Description                             |
| --------- | -------- | --------------------------------------- |
| `fxType`  | `FxType` | The FX type to create an animation for. |

Returns [class `AnimatedSprite`](#class-animatedsprite) | null. Returns `null` if the configuration or base image is missing.

##### private function `getColoredAnimatedSprite()`

| Parameter | Type         | Description                      |
| --------- | ------------ | -------------------------------- |
| `owner`   | `PlayerView` | The player owning the animation. |
| `fxType`  | `FxType`     | The FX type.                     |
| `theme`   | `Theme`      | The theme to colorize with.      |

Returns `HTMLCanvasElement | null`. Returns `null` if the configuration or base image is missing.

##### private function `createColoredAnimatedSpriteForUnit()`

| Parameter | Type         | Description                      |
| --------- | ------------ | -------------------------------- |
| `fxType`  | `FxType`     | The FX type.                     |
| `owner`   | `PlayerView` | The player owning the animation. |
| `theme`   | `Theme`      | The theme to colorize with.      |

Returns [class `AnimatedSprite`](#class-animatedsprite) | null. Returns `null` if the configuration or colorized image is missing.

##### public function `createAnimatedSprite()`

| Parameter | Type         | Description                                |
| --------- | ------------ | ------------------------------------------ |
| `fxType`  | `FxType`     | The FX type.                               |
| `owner?`  | `PlayerView` | Optional owner to colorize the sprite for. |
| `theme?`  | `Theme`      | Optional theme for colorization.           |

Returns [class `AnimatedSprite`](#class-animatedsprite) | null. Returns `null` if the resources or configuration are unavailable.

See also: [function `createRegularAnimatedSprite()`](#private-function-createregularanimatedsprite), [function `getColoredAnimatedSprite()`](#private-function-getcoloredanimatedsprite)

### GameRenderer.ts

#### function `createRenderer()`

| Parameter  | Type                | Description                        |
| ---------- | ------------------- | ---------------------------------- |
| `canvas`   | `HTMLCanvasElement` | The canvas element for rendering.  |
| `game`     | `GameView`          | The game instance.                 |
| `eventBus` | `EventBus`          | The event bus for handling events. |

Returns `GameRenderer`.

Initializes various UI layers, sets up event listeners, and prepares the canvas for rendering. Also handles references to modals, sidebars, panels, and other game layers.

#### class `GameRenderer`

Manages rendering of the entire game onto a canvas, including layered drawing, transformations, and FPS tracking.

**Properties:**

| Name               | Type                       | Description                                       |
| ------------------ | -------------------------- | ------------------------------------------------- |
| `transformHandler` | `TransformHandler`         | Handles coordinate transformations for rendering. |
| `uiState`          | `UIState`                  | Stores state for UI layers.                       |
| `context`          | `CanvasRenderingContext2D` | 2D rendering context of the canvas.               |

##### public constructor `constructor()`

| Parameter          | Type                | Description                        |
| ------------------ | ------------------- | ---------------------------------- |
| `game`             | `GameView`          | The game instance.                 |
| `eventBus`         | `EventBus`          | Event bus for handling events.     |
| `canvas`           | `HTMLCanvasElement` | Canvas element for rendering.      |
| `transformHandler` | `TransformHandler`  | Manages rendering transformations. |
| `uiState`          | `UIState`           | State for UI components.           |
| `layers`           | `Layer[]`           | Array of layers to render.         |
| `fpsDisplay`       | `FPSDisplay`        | Layer for FPS tracking.            |

Throws an error if the 2D canvas context is unavailable.

##### public function `initialize()`

Sets up event listeners, appends canvas to the DOM, initializes layers, and starts the render loop.

Returns `void`.

##### public function `resizeCanvas()`

Resizes the canvas to match the window size and updates the transform handler.

Returns `void`.

##### public function `redraw()`

Calls `redraw()` on all layers that implement it.

Returns `void`.

##### public function `renderGame()`

Handles the main render loop: clears the canvas, applies transformations, renders all layers in order, updates FPS, and logs slow frames.

Returns `void`.

##### public function `tick()`

Calls `tick()` on all layers that implement it.

Returns `void`.

##### public function `resize()`

| Parameter | Type     | Description               |
| --------- | -------- | ------------------------- |
| `width`   | `number` | New width of the canvas.  |
| `height`  | `number` | New height of the canvas. |

Resizes the canvas accounting for `devicePixelRatio`.

Returns `void`.

### NameBoxCalculator.ts

#### interface `Point`

Represents a 2D point.

| Name | Type     | Description  |
| ---- | -------- | ------------ |
| `x`  | `number` | X-coordinate |
| `y`  | `number` | Y-coordinate |

#### interface `Rectangle`

Represents a rectangle.

| Name     | Type     | Description                         |
| -------- | -------- | ----------------------------------- |
| `x`      | `number` | X-coordinate of the top-left corner |
| `y`      | `number` | Y-coordinate of the top-left corner |
| `width`  | `number` | Width of the rectangle              |
| `height` | `number` | Height of the rectangle             |

#### public function `placeName()`

| Parameter | Type     | Description                           |
| --------- | -------- | ------------------------------------- |
| `game`    | `Game`   | The game instance                     |
| `player`  | `Player` | The player whose name is being placed |

Returns `NameViewData`. Computes the optimal position and font size for a player's name based on the largest cluster of tiles they control. Falls back to the bounding box of border tiles if the largest cluster is not available.

See also: [function `createGrid()`](#public-function-creategrid), [function `findLargestInscribedRectangle()`](#public-function-findlargestinscribedrectangle), [function `calculateFontSize()`](#public-function-calculatefontsize)

#### public function `createGrid()`

| Parameter       | Type                         | Description                              |
| --------------- | ---------------------------- | ---------------------------------------- |
| `game`          | `Game`                       | The game instance                        |
| `player`        | `Player`                     | The player for whom the grid is created  |
| `boundingBox`   | `{ min: Point; max: Point }` | Bounding box to generate the grid within |
| `scalingFactor` | `number`                     | Factor to scale the grid by              |

Returns `boolean[][]`. Generates a boolean occupancy grid representing tiles controlled or owned by the player. Each cell is `true` if it is a lake, owned by the player, or contains fallout; otherwise `false`.

See also: [interface `Point`](#interface-point)

#### public function `findLargestInscribedRectangle()`

| Parameter | Type          | Description    |
| --------- | ------------- | -------------- |
| `grid`    | `boolean[][]` | Occupancy grid |

Returns `Rectangle`. Finds the largest rectangle of `true` values within a boolean grid.

See also: [interface `Rectangle`](#interface-rectangle), [function `largestRectangleInHistogram()`](#public-function-largestrectangleinhistogram)

#### public function `largestRectangleInHistogram()`

| Parameter | Type       | Description                                      |
| --------- | ---------- | ------------------------------------------------ |
| `widths`  | `number[]` | Array representing column heights in a histogram |

Returns `Rectangle`. Computes the largest rectangle that can be formed in a histogram represented by the input array.

See also: [interface `Rectangle`](#interface-rectangle)

#### public function `calculateFontSize()`

| Parameter   | Type        | Description                        |
| ----------- | ----------- | ---------------------------------- |
| `rectangle` | `Rectangle` | The rectangle to fit the name into |
| `name`      | `string`    | The name string to fit             |

Returns `number`. Calculates the font size that will fit the provided name within the given rectangle, constrained by width and height.

See also: [interface `Rectangle`](#interface-rectangle)

### ProgressBar.ts

#### class `ProgressBar`

Renders a progress/loading bar on a canvas context and allows updating its progress dynamically.

**Properties:**

| Name       | Type                       | Description                                                                            |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `colors`   | `string[]`                 | Optional array of colors used to display progress segments. Defaults to gray if empty. |
| `ctx`      | `CanvasRenderingContext2D` | Canvas rendering context for drawing the progress bar.                                 |
| `x`        | `number`                   | X-coordinate of the progress bar's top-left corner.                                    |
| `y`        | `number`                   | Y-coordinate of the progress bar's top-left corner.                                    |
| `w`        | `number`                   | Width of the progress bar.                                                             |
| `h`        | `number`                   | Height of the progress bar.                                                            |
| `progress` | `number`                   | Current progress value between 0 and 1. Defaults to 0.                                 |

##### public constructor `constructor()`

| Parameter   | Type                       | Description                                           |
| ----------- | -------------------------- | ----------------------------------------------------- |
| `colors?`   | `string[]`                 | Optional array of colors for the progress segments.   |
| `ctx`       | `CanvasRenderingContext2D` | Canvas context to render on.                          |
| `x`         | `number`                   | X-coordinate of the top-left corner.                  |
| `y`         | `number`                   | Y-coordinate of the top-left corner.                  |
| `w`         | `number`                   | Width of the progress bar.                            |
| `h`         | `number`                   | Height of the progress bar.                           |
| `progress?` | `number`                   | Optional initial progress from 0 to 1. Defaults to 0. |

Returns `ProgressBar`. Initializes the progress bar and draws its initial state.

##### public function `setProgress()`

| Parameter  | Type     | Description                                                            |
| ---------- | -------- | ---------------------------------------------------------------------- |
| `progress` | `number` | Progress value between 0 and 1. Values outside this range are clamped. |

Returns `void`. Updates the progress value and redraws the bar. Fills background, draws the progress portion with the appropriate color, and stores the updated progress.

##### public function `clear()`

Returns `void`. Clears the area occupied by the progress bar, including a padding of `CLEAR_PADDING` pixels.

##### public function `getX()`

Returns `number`. Returns the X-coordinate of the progress bar.

##### public function `getY()`

Returns `number`. Returns the Y-coordinate of the progress bar.

##### public function `getProgress()`

Returns `number`. Returns the current progress value between 0 and 1.

### SpriteLoader.ts

#### Constants

##### type `TrainTypeSprite`

Defines train sprite categories.

| Name             | Type               | Description            |
| ---------------- | ------------------ | ---------------------- |
| `Engine`         | `"Engine"`         | Engine sprite          |
| `Carriage`       | `"Carriage"`       | Carriage sprite        |
| `LoadedCarriage` | `"LoadedCarriage"` | Loaded carriage sprite |

##### `SPRITE_CONFIG`

Partial mapping of unit types and train sprites to image URLs.

##### `spriteMap`

Map storing loaded `ImageBitmap` objects for each unit type or train sprite.

##### `coloredSpriteCache`

Map caching colorized `HTMLCanvasElement` instances keyed by unit, owner, and color combination.

#### public function `loadAllSprites()`

Returns `Promise<void>`. Preloads all sprites defined in `SPRITE_CONFIG` as `ImageBitmap` and populates `spriteMap`. Logs warnings if URLs are missing and errors if loading fails.

#### private function `trainTypeToSpriteType()`

| Parameter | Type       | Description                        |
| --------- | ---------- | ---------------------------------- |
| `unit`    | `UnitView` | Unit instance representing a train |

Returns `TrainTypeSprite`. Maps train attributes (engine, carriage, loaded) to the appropriate sprite type.

#### private function `getSpriteForUnit()`

| Parameter | Type       | Description   |
| --------- | ---------- | ------------- |
| `unit`    | `UnitView` | Unit instance |

Returns `ImageBitmap | null`. Retrieves the `ImageBitmap` for a given unit, handling train types via `trainTypeToSpriteType()`. Returns `null` if no sprite is loaded.

#### public function `isSpriteReady()`

| Parameter | Type       | Description   |
| --------- | ---------- | ------------- |
| `unit`    | `UnitView` | Unit instance |

Returns `boolean`. Indicates whether the sprite for the unit is loaded and ready for rendering.

#### public function `colorizeCanvas()`

| Parameter | Type                                                    | Description                                              |
| --------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `source`  | `CanvasImageSource & { width: number; height: number }` | Source image to colorize                                 |
| `colorA`  | `Colord`                                                | Territory color replacement for light gray pixels        |
| `colorB`  | `Colord`                                                | Border color replacement for dark gray pixels            |
| `colorC`  | `Colord`                                                | Spawn highlight color replacement for medium gray pixels |

Returns `HTMLCanvasElement`. Creates a new canvas, draws the source image, and replaces grayscale pixels with the provided colors.

#### private function `computeSpriteKey()`

| Parameter        | Type       | Description                       |
| ---------------- | ---------- | --------------------------------- |
| `unit`           | `UnitView` | Unit instance                     |
| `territoryColor` | `Colord`   | Territory color used for coloring |
| `borderColor`    | `Colord`   | Border color used for coloring    |

Returns `string`. Computes a unique key for caching colorized sprites based on unit, owner, train type, and colors.

#### public function `getColoredSprite()`

| Parameter               | Type       | Description                           |
| ----------------------- | ---------- | ------------------------------------- |
| `unit`                  | `UnitView` | Unit instance to render               |
| `theme`                 | `Theme`    | Theme providing spawn highlight color |
| `customTerritoryColor?` | `Colord`   | Optional custom territory color       |
| `customBorderColor?`    | `Colord`   | Optional custom border color          |

Returns `HTMLCanvasElement`. Retrieves or generates a colorized sprite canvas for the unit using `colorizeCanvas()`. Uses `coloredSpriteCache` for performance. Throws an error if the sprite is unavailable.

See also: [function `colorizeCanvas()`](#public-function-colorizecanvas), [function `getSpriteForUnit()`](#private-function-getspriteforunit)

### TransformHandler.ts

#### Constants

| Name               | Type     | Description                                                          |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `GOTO_INTERVAL_MS` | `number` | Interval in milliseconds for camera movement updates (default 16ms). |
| `CAMERA_MAX_SPEED` | `number` | Maximum speed for camera movement.                                   |
| `CAMERA_SMOOTHING` | `number` | Smoothing factor for camera movement interpolation.                  |

#### class `TransformHandler`

Handles camera transformations including zooming, panning, centering, and smooth movements within a game viewport.

**Properties:**

| Name               | Type                     | Description                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------------- |
| `scale`            | `number`                 | Current zoom level. Defaults to 1.8.                          |
| `_boundingRect`    | `DOMRect`                | Current canvas bounding rectangle.                            |
| `offsetX`          | `number`                 | Horizontal camera offset.                                     |
| `offsetY`          | `number`                 | Vertical camera offset.                                       |
| `lastGoToCallTime` | `number \| null`         | Timestamp of the last camera goTo call.                       |
| `target`           | `Cell \| null`           | Current target cell for camera movement.                      |
| `intervalID`       | `NodeJS.Timeout \| null` | Interval ID for smooth camera movement.                       |
| `changed`          | `boolean`                | Tracks if the camera transform has changed since last update. |

##### public constructor `constructor()`

| Parameter  | Type                | Description                                      |
| ---------- | ------------------- | ------------------------------------------------ |
| `game`     | `GameView`          | The game view instance.                          |
| `eventBus` | `EventBus`          | Event bus to listen for input and camera events. |
| `canvas`   | `HTMLCanvasElement` | Canvas element for the game viewport.            |

Initializes the camera transform handler and registers event listeners.

##### public function `updateCanvasBoundingRect()`

Returns `void`. Updates the internal `_boundingRect` based on the current canvas size.

##### public function `boundingRect()`

Returns `DOMRect`. Retrieves the current canvas bounding rectangle.

##### public function `width()`

Returns `number`. Width of the canvas.

##### public function `hasChanged()`

Returns `boolean`. Indicates whether the camera transform has changed.

##### public function `resetChanged()`

Returns `void`. Resets the `changed` flag.

##### public function `handleTransform()`

| Parameter | Type                       | Description                                       |
| --------- | -------------------------- | ------------------------------------------------- |
| `context` | `CanvasRenderingContext2D` | Rendering context to apply the transformation to. |

Returns `void`. Applies zoom and pan transformations to the canvas context, disabling image smoothing for pixelated effect.

##### public function `worldToScreenCoordinates()`

| Parameter | Type   | Description                 |
| --------- | ------ | --------------------------- |
| `cell`    | `Cell` | Game world cell to convert. |

Returns `{ x: number; y: number }`. Converts world coordinates to screen coordinates.

##### public function `screenToWorldCoordinates()`

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `screenX` | `number` | X-coordinate on screen. |
| `screenY` | `number` | Y-coordinate on screen. |

Returns `Cell`. Converts screen coordinates to world coordinates.

##### public function `screenBoundingRect()`

Returns `[Cell, Cell]`. Returns top-left and bottom-right cells currently visible on the screen.

##### public function `isOnScreen()`

| Parameter | Type   | Description    |
| --------- | ------ | -------------- |
| `cell`    | `Cell` | Cell to check. |

Returns `boolean`. Determines if a cell is within the current camera view.

##### public function `screenCenter()`

Returns `{ screenX: number; screenY: number }`. Computes the screen coordinates of the viewport center.

##### public function `onGoToPlayer()`

| Parameter | Type              | Description                           |
| --------- | ----------------- | ------------------------------------- |
| `event`   | `GoToPlayerEvent` | Event containing player to center on. |

Returns `void`. Initiates smooth camera movement to the player's position.

##### public function `onGoToPosition()`

| Parameter | Type                | Description                                      |
| --------- | ------------------- | ------------------------------------------------ |
| `event`   | `GoToPositionEvent` | Event containing world coordinates to center on. |

Returns `void`. Initiates smooth camera movement to the specified position.

##### public function `onGoToUnit()`

| Parameter | Type            | Description                         |
| --------- | --------------- | ----------------------------------- |
| `event`   | `GoToUnitEvent` | Event containing unit to center on. |

Returns `void`. Initiates smooth camera movement to the unit's last tile.

##### public function `centerCamera()`

Returns `void`. Centers the camera on the local player's position.

##### private function `goTo()`

Returns `void`. Moves the camera smoothly towards the target cell, respecting maximum speed and smoothing constraints. Clears target once reached.

##### public function `onZoom()`

| Parameter | Type        | Description                                        |
| --------- | ----------- | -------------------------------------------------- |
| `event`   | `ZoomEvent` | Event containing zoom delta and mouse coordinates. |

Returns `void`. Adjusts camera scale and offsets to zoom around a point. Clamps scale and

### UIState.ts

#### interface `UIState`

Represents the current state of the user interface related to game actions.

| Name             | Type      | Description                                                            |
| ---------------- | --------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `attackRatio`    | `number`  | Ratio used for attacks, e.g., proportion of available units to deploy. |
| `ghostStructure` | `UnitType | null`                                                                  | Optional unit type representing a ghosted structure in the UI, or `null` if none is selected. |

### ./fx/ConquestFx.ts

#### public function `conquestFxFactory()`

| Parameter              | Type                   | Description                                                                  |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `animatedSpriteLoader` | `AnimatedSpriteLoader` | Loader for animated conquest sprites.                                        |
| `conquest`             | `ConquestUpdate`       | Update containing conquest information such as gold and conquered player ID. |
| `game`                 | `GameView`             | Game view instance providing player positions.                               |

Returns `Fx[]`. Generates a list of visual effects representing a conquest event, including:

- Animated conquest sprite with fade effect.
- Text displaying gold gained, positioned near the conquered player's location.

See also: [class `SpriteFx`](#class-spritefx), [class `FadeFx`](#class-fadefx), [class `TextFx`](#class-textfx), [class `AnimatedSpriteLoader`](#class-animatedspriteloader)

### ./fx/Fx.ts

#### interface `Fx`

Represents a visual effect in the game.

##### public function `renderTick()`

| Parameter  | Type                       | Description                                       |
| ---------- | -------------------------- | ------------------------------------------------- |
| `duration` | `number`                   | Time elapsed since the last tick in milliseconds. |
| `ctx`      | `CanvasRenderingContext2D` | Canvas context used for rendering the effect.     |

Returns `boolean`. Indicates whether the effect is still active (`true`) or has finished (`false`).

#### enum `FxType`

Enumerates types of effects available in the game.

| Name                | Description                              |
| ------------------- | ---------------------------------------- |
| `MiniFire`          | Small fire effect                        |
| `MiniSmoke`         | Small smoke effect                       |
| `MiniBigSmoke`      | Large smoke effect                       |
| `MiniSmokeAndFire`  | Combined smoke and fire effect           |
| `MiniExplosion`     | Small explosion effect                   |
| `UnitExplosion`     | Explosion effect for units               |
| `BuildingExplosion` | Explosion effect for buildings           |
| `SinkingShip`       | Sinking ship effect                      |
| `Nuke`              | Nuclear explosion effect                 |
| `SAMExplosion`      | Surface-to-air missile explosion effect  |
| `UnderConstruction` | Effect for under-construction structures |
| `Dust`              | Dust effect                              |
| `Conquest`          | Conquest effect                          |
| `Tentacle`          | Tentacle effect                          |
| `Shark`             | Shark effect                             |
| `Bubble`            | Bubble effect                            |
| `Tornado`           | Tornado effect                           |

### ./fx/NukeArea.ts

#### class `NukeAreaFx`

Represents a visual effect showing a nuclear explosion area with inner and outer circles.

Implements: [interface `Fx`](#interface-fx)

**Properties:**

| Name                     | Type      | Description                                                 |
| ------------------------ | --------- | ----------------------------------------------------------- |
| `lifeTime`               | `number`  | Time elapsed since effect started.                          |
| `ended`                  | `boolean` | Indicates whether the effect has been marked for fade-out.  |
| `endAnimationDuration`   | `number`  | Duration of fade-out in milliseconds.                       |
| `startAnimationDuration` | `number`  | Duration of start animation in milliseconds.                |
| `innerDiameter`          | `number`  | Diameter of the inner circle.                               |
| `outerDiameter`          | `number`  | Diameter of the outer circle.                               |
| `offset`                 | `number`  | Current dash offset for rotating outer circle.              |
| `dashSize`               | `number`  | Length of dashes for outer circle stroke.                   |
| `rotationSpeed`          | `number`  | Rotation speed of outer dashed circle in pixels per second. |
| `baseAlpha`              | `number`  | Base transparency for the effect.                           |

##### public constructor `constructor()`

| Parameter   | Type            | Description                                        |
| ----------- | --------------- | -------------------------------------------------- |
| `x`         | `number`        | X-coordinate of effect center.                     |
| `y`         | `number`        | Y-coordinate of effect center.                     |
| `magnitude` | `NukeMagnitude` | Nuke magnitude defining inner and outer diameters. |

Initializes a nuke area effect with scaling and dashed rotation for the outer circle.

##### public function `end()`

Returns `void`. Marks the effect for fade-out, resetting `lifeTime` for end animation.

##### public function `renderTick()`

| Parameter   | Type                       | Description                                          |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `frameTime` | `number`                   | Time elapsed since last render tick in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Canvas context to render the effect.                 |

Returns `boolean`. Renders the nuke area effect for this tick. Returns `true` if the effect is still active, `false` if finished. Draws inner and outer circles with alpha blending and animated outer dash rotation.

See also: [interface `Fx`](#interface-fx), [type `NukeMagnitude`](../../../core/configuration/Config)

### ./fx/NukeFx.ts

#### class `ShockwaveFx`

Represents a shockwave effect as a growing white circle for nuclear explosions.

Implements: [interface `Fx`](#interface-fx)

**Properties:**

| Name        | Type     | Description                                |
| ----------- | -------- | ------------------------------------------ |
| `lifeTime`  | `number` | Time elapsed since effect started.         |
| `x`         | `number` | X-coordinate of the shockwave center.      |
| `y`         | `number` | Y-coordinate of the shockwave center.      |
| `duration`  | `number` | Duration of the shockwave in milliseconds. |
| `maxRadius` | `number` | Maximum radius the shockwave can reach.    |

##### public constructor `constructor()`

| Parameter   | Type     | Description                                |
| ----------- | -------- | ------------------------------------------ |
| `x`         | `number` | X-coordinate of effect center.             |
| `y`         | `number` | Y-coordinate of effect center.             |
| `duration`  | `number` | Duration of the shockwave in milliseconds. |
| `maxRadius` | `number` | Maximum radius of the shockwave.           |

##### public function `renderTick()`

| Parameter   | Type                       | Description                                   |
| ----------- | -------------------------- | --------------------------------------------- |
| `frameTime` | `number`                   | Time elapsed since last tick in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Canvas context to render the effect.          |

Returns `boolean`. Renders the shockwave for the current tick. Returns `true` if the effect is still active, `false` if finished.

#### private function `addSpriteInCircle()`

| Parameter              | Type                   | Description                                        |
| ---------------------- | ---------------------- | -------------------------------------------------- |
| `animatedSpriteLoader` | `AnimatedSpriteLoader` | Loader for animated sprites.                       |
| `x`                    | `number`               | Center X-coordinate for spawning sprites.          |
| `y`                    | `number`               | Center Y-coordinate for spawning sprites.          |
| `radius`               | `number`               | Radius of the spawn circle.                        |
| `num`                  | `number`               | Number of sprites to spawn.                        |
| `type`                 | `FxType`               | Type of effect to spawn.                           |
| `result`               | `Fx[]`                 | Array to push spawned Fx instances into.           |
| `game`                 | `GameView`             | Game view instance for validating spawn positions. |

Returns `void`. Spawns `num` effects of `type` randomly within a circular area, validating coordinates and terrain.

#### public function `nukeFxFactory()`

| Parameter              | Type                   | Description                                |
| ---------------------- | ---------------------- | ------------------------------------------ |
| `animatedSpriteLoader` | `AnimatedSpriteLoader` | Loader for animated nuke sprites.          |
| `x`                    | `number`               | X-coordinate of nuke center.               |
| `y`                    | `number`               | Y-coordinate of nuke center.               |
| `radius`               | `number`               | Radius for shockwave and debris placement. |
| `game`                 | `GameView`             | Game view instance for terrain checks.     |

Returns `Fx[]`. Generates all visual effects for a nuclear explosion, including:

- Central explosion sprite.
- Shockwave (`ShockwaveFx`).
- Randomized debris and desolation sprites using `addSpriteInCircle`.

See also: [class `SpriteFx`](#class-spritefx), [class `FadeFx`](#class-fadefx), [interface `Fx`](#interface-fx), [enum `FxType`](#enum-fxtype), [class `ShockwaveFx`](#class-shockwavefx), [class `AnimatedSpriteLoader`](#class-animatedspriteloader)

### ./fx/SpriteFx.ts

#### class `MoveSpriteFx`

Moves an existing `SpriteFx` instance from its current position to a target position over time, optionally fading in and out.

Implements: [interface `Fx`](#interface-fx)

**Properties:**

| Name       | Type       | Description                               |
| ---------- | ---------- | ----------------------------------------- |
| `originX`  | `number`   | Initial X-coordinate of the sprite.       |
| `originY`  | `number`   | Initial Y-coordinate of the sprite.       |
| `fxToMove` | `SpriteFx` | The sprite to move.                       |
| `toX`      | `number`   | Target X-coordinate.                      |
| `toY`      | `number`   | Target Y-coordinate.                      |
| `fadeIn`   | `number`   | Optional fade-in fraction (default 0.1).  |
| `fadeOut`  | `number`   | Optional fade-out fraction (default 0.9). |

##### public constructor `constructor()`

| Parameter  | Type       | Description                 |
| ---------- | ---------- | --------------------------- |
| `fxToMove` | `SpriteFx` | The sprite to move.         |
| `toX`      | `number`   | Target X-coordinate.        |
| `toY`      | `number`   | Target Y-coordinate.        |
| `fadeIn?`  | `number`   | Optional fade-in fraction.  |
| `fadeOut?` | `number`   | Optional fade-out fraction. |

##### public function `renderTick()`

| Parameter  | Type                       | Description                                   |
| ---------- | -------------------------- | --------------------------------------------- |
| `duration` | `number`                   | Time elapsed since last tick in milliseconds. |
| `ctx`      | `CanvasRenderingContext2D` | Canvas context for rendering.                 |

Returns `boolean`. Updates the sprite position and renders it with fade-in/out transparency. Returns `false` when animation ends.

#### class `FadeFx`

Fades an existing `SpriteFx` instance in and out over time.

Implements: [interface `Fx`](#interface-fx)

**Properties:**

| Name       | Type       | Description                        |
| ---------- | ---------- | ---------------------------------- |
| `fxToFade` | `SpriteFx` | Sprite to fade.                    |
| `fadeIn`   | `number`   | Fraction of duration for fade-in.  |
| `fadeOut`  | `number`   | Fraction of duration for fade-out. |

##### public constructor `constructor()`

| Parameter  | Type       | Description                       |
| ---------- | ---------- | --------------------------------- |
| `fxToFade` | `SpriteFx` | Sprite to fade.                   |
| `fadeIn`   | `number`   | Fraction of duration to fade in.  |
| `fadeOut`  | `number`   | Fraction of duration to fade out. |

##### public function `renderTick()`

| Parameter  | Type                       | Description                                   |
| ---------- | -------------------------- | --------------------------------------------- |
| `duration` | `number`                   | Time elapsed since last tick in milliseconds. |
| `ctx`      | `CanvasRenderingContext2D` | Canvas context for rendering.                 |

Returns `boolean`. Renders the sprite with computed transparency based on fade-in/out. Returns `false` when animation ends.

#### class `SpriteFx`

Animated sprite effect that can be optionally colored based on owner and theme.

Implements: [interface `Fx`](#interface-fx)

**Properties:**

| Name             | Type                     | Description                                                        |
| ---------------- | ------------------------ | ------------------------------------------------------------------ |
| `animatedSprite` | `AnimatedSprite \| null` | The underlying animated sprite.                                    |
| `elapsedTime`    | `number`                 | Time elapsed since animation started.                              |
| `duration`       | `number`                 | Duration of animation in milliseconds.                             |
| `waitToTheEnd`   | `boolean`                | Whether to wait for sprite lifetime instead of specified duration. |
| `x`              | `number`                 | X-coordinate of sprite position.                                   |
| `y`              | `number`                 | Y-coordinate of sprite position.                                   |

##### public constructor `constructor()`

| Parameter              | Type                   | Description                        |
| ---------------------- | ---------------------- | ---------------------------------- |
| `animatedSpriteLoader` | `AnimatedSpriteLoader` | Loader to create animated sprite.  |
| `x`                    | `number`               | Initial X-coordinate.              |
| `y`                    | `number`               | Initial Y-coordinate.              |
| `fxType`               | `FxType`               | Type of effect.                    |
| `duration?`            | `number`               | Optional duration for the effect.  |
| `owner?`               | `PlayerView`           | Optional owner to colorize sprite. |
| `theme?`               | `Theme`                | Optional theme for coloring.       |

##### public function `renderTick()`

| Parameter   | Type                       | Description                                   |
| ----------- | -------------------------- | --------------------------------------------- |
| `frameTime` | `number`                   | Time elapsed since last tick in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Canvas context for rendering.                 |

Returns `boolean`. Updates the animated sprite and draws it. Returns `false` if the animation has finished.

##### public function `getElapsedTime()`

Returns `number`. The elapsed time since the animation started.

##### public function `getDuration()`

Returns `number`. The total duration of the animation.

See also: [interface `Fx`](#interface-fx), [class `AnimatedSprite`](#class-animatedsprite), [class `AnimatedSpriteLoader`](#class-animatedspriteloader), [enum `FxType`](#enum-fxtype), [class `FadeFx`](#class-fadefx)

### ./fx/TargetFx.ts

#### class `TargetFx`

Implements a pulsing/red targeting effect on the canvas, optionally persistent.

**Properties:**

| Name            | Type      | Description                                                                                  |
| --------------- | --------- | -------------------------------------------------------------------------------------------- |
| `lifeTime`      | `number`  | Tracks elapsed time of the effect.                                                           |
| `ended`         | `boolean` | Marks whether the effect is in fade-out phase.                                               |
| `endFade`       | `number`  | Duration of fade-out in milliseconds.                                                        |
| `offset`        | `number`  | Offset for dash rotation animation.                                                          |
| `rotationSpeed` | `number`  | Rotation speed in pixels per second.                                                         |
| `radius`        | `number`  | Inner circle radius.                                                                         |
| `x`             | `number`  | X-coordinate of the target effect.                                                           |
| `y`             | `number`  | Y-coordinate of the target effect.                                                           |
| `duration`      | `number`  | Total duration in ms if not persistent. Optional; defaults to `0`.                           |
| `persistent`    | `boolean` | If `true`, effect loops indefinitely until `end()` is called. Optional; defaults to `false`. |

##### public function `end()`

Returns `void`.

Triggers the fade-out for persistent effects. Resets `lifeTime` to 0 for fade timing.

##### public function `renderTick()`

| Parameter   | Type                       | Description                                    |
| ----------- | -------------------------- | ---------------------------------------------- |
| `frameTime` | `number`                   | Elapsed time since last frame in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Canvas rendering context.                      |

Returns `boolean`. `true` if the effect is still active and should continue rendering; `false` if the effect has ended.

Behavior:

- Updates internal `lifeTime` and computes alpha for fade-in, fade-out, or pulsing.
- Draws two concentric circles with dashed stroke animation.
- Outer circle dashes rotate in opposite directions relative to the inner circle.

### ./fx/TextFx.ts

#### class `TextFx`

Displays floating text with fade-out and vertical rise over a duration.

**Properties:**

| Name           | Type                                  | Description                                                                    |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| `lifeTime`     | `number`                              | Tracks elapsed time since creation.                                            |
| `text`         | `string`                              | Text content to display.                                                       |
| `x`            | `number`                              | X-coordinate of text origin.                                                   |
| `y`            | `number`                              | Y-coordinate of text origin.                                                   |
| `duration`     | `number`                              | Total display duration in milliseconds.                                        |
| `riseDistance` | `number`                              | Vertical rise in pixels during the effect. Optional; defaults to `30`.         |
| `font`         | `string`                              | CSS font string for text rendering. Optional; defaults to `"11px sans-serif"`. |
| `color`        | `{ r: number; g: number; b: number }` | RGB color of the text. Optional; defaults to white `{r:255,g:255,b:255}`.      |

##### public function `renderTick()`

| Parameter   | Type                       | Description                                    |
| ----------- | -------------------------- | ---------------------------------------------- |
| `frameTime` | `number`                   | Elapsed time since last frame in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Canvas rendering context.                      |

Returns `boolean`. `true` if the text is still visible; `false` once the duration has elapsed.

Behavior:

- Increments `lifeTime`.
- Computes vertical position based on elapsed time and `riseDistance`.
- Computes fade-out alpha based on elapsed time.
- Draws the text centered at `(x, currentY)` with computed alpha.

### ./fx/Timeline.ts

#### class `Timeline`

Schedules and executes delayed tasks in sequence.

**Properties:**

| Name          | Type          | Description                                              |
| ------------- | ------------- | -------------------------------------------------------- |
| `tasks`       | `TimedTask[]` | Array of scheduled tasks with delay and execution state. |
| `timeElapsed` | `number`      | Total elapsed time since timeline start.                 |

##### public function `add()`

| Parameter | Type         | Description                                           |
| --------- | ------------ | ----------------------------------------------------- |
| `delay`   | `number`     | Delay in milliseconds before the action is triggered. |
| `action`  | `() => void` | Callback to execute after delay.                      |

Returns `Timeline`. Adds a task to the timeline and allows chaining.

##### public function `update()`

| Parameter | Type     | Description                                   |
| --------- | -------- | --------------------------------------------- |
| `dt`      | `number` | Time delta in milliseconds since last update. |

Returns `void`. Updates the timeline, triggers any tasks whose delay has elapsed.

##### public function `isComplete()`

Returns `boolean`. `true` if all tasks have been triggered; otherwise `false`.

**Internal type `TimedTask`**

| Name        | Type         | Description                                              |
| ----------- | ------------ | -------------------------------------------------------- |
| `delay`     | `number`     | Milliseconds after timeline start to trigger the action. |
| `action`    | `() => void` | Function to execute when delay elapses.                  |
| `triggered` | `boolean`    | Tracks whether the task has already executed.            |

### ./fx/UnitExplosionFx.ts

#### class `UnitExplosionFx`

Implements a timed explosion effect composed of multiple `SpriteFx` instances.

**Properties:**

| Name         | Type       | Description                                              |
| ------------ | ---------- | -------------------------------------------------------- |
| `timeline`   | `Timeline` | Manages the scheduling of multiple explosions over time. |
| `explosions` | `Fx[]`     | List of active explosion effects.                        |

##### public constructor `UnitExplosionFx()`

| Parameter              | Type                   | Description                                           |
| ---------------------- | ---------------------- | ----------------------------------------------------- |
| `animatedSpriteLoader` | `AnimatedSpriteLoader` | Loader for animated sprite resources.                 |
| `x`                    | `number`               | X-coordinate of the central explosion point.          |
| `y`                    | `number`               | Y-coordinate of the central explosion point.          |
| `game`                 | `GameView`             | Reference to the game view for coordinate validation. |

Initializes a `Timeline` with three explosion events at offsets relative to `(x, y)`.

##### public function `renderTick()`

| Parameter   | Type                       | Description                                          |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `frameTime` | `number`                   | Time elapsed since last render tick in milliseconds. |
| `ctx`       | `CanvasRenderingContext2D` | Rendering context for drawing explosions.            |

Returns `boolean`. Returns `true` if the explosion effect is still active; `false` if all explosions have completed.

Behavior:

- Updates the timeline and triggers scheduled explosions.
- Renders all active `SpriteFx` explosions.
- Returns `true` until all explosions are done and the timeline is complete.

### ./layers/AdTimer.ts

#### class `AdTimer`

Manages timed removal of sticky advertisements based on game ticks.

Implements: [`Layer`](#)

**Properties:**

| Name       | Type       | Description                          |
| ---------- | ---------- | ------------------------------------ |
| `isHidden` | `boolean`  | Tracks whether ads have been hidden. |
| `g`        | `GameView` | Reference to the game view instance. |

##### public constructor `AdTimer()`

| Parameter | Type       | Description                                               |
| --------- | ---------- | --------------------------------------------------------- |
| `g`       | `GameView` | Game view instance used to track ticks and configuration. |

##### public function `init()`

Returns `void`.

Initializes the layer. Currently a placeholder with no behavior.

##### public async function `tick()`

Returns `Promise<void>`.

Checks whether the sticky ads should be removed based on game ticks. If the ads are due to be removed, it calls `window.fusetag.destroySticky()` and sets `isHidden` to `true`. Logs action to the console.

### ./layers/AlertFrame.ts

#### class `AlertFrame`

Displays a visual alert border when the current player is betrayed in-game. Implements [interface `Layer`](#).

**Properties:**

| Name               | Type           | Description                                                 |                                                       |
| ------------------ | -------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `game`             | `GameView`     | The game instance associated with this alert layer.         |                                                       |
| `userSettings`     | `UserSettings` | Stores user preferences for alert visibility.               |                                                       |
| `isActive`         | `boolean`      | Internal state indicating if the alert is currently active. |                                                       |
| `animationTimeout` | `number        | null`                                                       | Timeout ID for controlling alert animation lifecycle. |

##### public constructor `constructor()`

Initializes the alert frame and injects the alert CSS into the document if not already present.

Returns `AlertFrame`.

##### public function `init()`

Returns `void`. Initializes event listeners for `BrokeAllianceUpdate` events from the game.

##### public function `tick()`

Returns `void`. Called each frame to check for `BrokeAllianceUpdate` events. Triggers alerts when the current player is betrayed.

##### public function `shouldTransform()`

Returns `boolean`. Indicates that the alert frame is not affected by camera transformations. Always returns `false`.

##### private function `onBrokeAllianceUpdate()`

| Parameter | Type                  | Description                                         |
| --------- | --------------------- | --------------------------------------------------- |
| `update`  | `BrokeAllianceUpdate` | Update information about the broken alliance event. |

Returns `void`. Activates the alert if the current player is the betrayed player.

See also: [function `activateAlert()`](#private-function-activatealert)

##### private function `activateAlert()`

Returns `void`. Sets `isActive` to `true` and requests a render update if user settings allow alert frames.

##### public function `dismissAlert()`

Returns `void`. Deactivates the alert, clears any running animation timeout, and requests a render update.

##### public function `render()`

Returns `TemplateResult`. Renders the alert border using HTML and CSS if `isActive` is true. Automatically dismisses the alert after animation ends.

### ./layers/BuildMenu.ts

#### interface `BuildItemDisplay`

Represents an item displayed in the build menu.

| Name           | Type       | Description                                         |
| -------------- | ---------- | --------------------------------------------------- |
| `unitType`     | `UnitType` | The type of unit or structure                       |
| `icon`         | `string`   | URL or path to the icon image                       |
| `description?` | `string`   | Optional translation key for the item's description |
| `key?`         | `string`   | Optional translation key for the item's name        |
| `countable?`   | `boolean`  | Optional flag indicating whether to show unit count |

#### const `buildTable`

A 2D array of [BuildItemDisplay](#interface-builditemdisplay) representing the layout of the build menu.

#### const `flattenedBuildTable`

Flattened version of `buildTable` for easy iteration.

#### class `BuildMenu`

Displays and manages the in-game build menu, allowing players to build or upgrade units and structures.
Implements [interface `Layer`](#).

**Properties:**

| Name                 | Type                   | Description                                                |                                                      |
| -------------------- | ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `game`               | `GameView`             | The game instance associated with this menu                |                                                      |
| `eventBus`           | `EventBus`             | Event bus for listening to and emitting input/game events  |                                                      |
| `clickedTile`        | `TileRef`              | Tile that was clicked to open the build menu               |                                                      |
| `playerActions`      | `PlayerActions         | null`                                                      | Actions available to the player for the clicked tile |
| `filteredBuildTable` | `BuildItemDisplay[][]` | Current filtered build table after removing disabled units |                                                      |
| `transformHandler`   | `TransformHandler`     | Handles screen-to-world coordinate conversions             |                                                      |
| `_hidden`            | `boolean`              | Internal state controlling menu visibility                 |                                                      |

##### public function `init()`

Returns `void`. Sets up event listeners to open, close, or hide the build menu based on game events.

##### public function `tick()`

Returns `void`. Called each frame to refresh the menu if it is visible.

##### public function `canBuildOrUpgrade()`

| Parameter | Type               | Description                                       |
| --------- | ------------------ | ------------------------------------------------- |
| `item`    | `BuildItemDisplay` | The item to check for build or upgrade capability |

Returns `boolean`. Returns `true` if the current player can build or upgrade the specified item.

##### public function `cost()`

| Parameter | Type               | Description                  |
| --------- | ------------------ | ---------------------------- |
| `item`    | `BuildItemDisplay` | The item to get the cost for |

Returns `Gold`. Returns the gold cost to build or upgrade the item, or `0` if unavailable.

##### public function `count()`

| Parameter | Type               | Description                 |
| --------- | ------------------ | --------------------------- |
| `item`    | `BuildItemDisplay` | The item to count units for |

Returns `string`. Returns the number of units of the specified type the player controls. Returns `"?"` if unknown.

##### public function `sendBuildOrUpgrade()`

| Parameter       | Type            | Description                               |
| --------------- | --------------- | ----------------------------------------- |
| `buildableUnit` | `BuildableUnit` | The unit or structure to build or upgrade |
| `tile`          | `TileRef`       | The tile on which to perform the action   |

Returns `void`. Emits the appropriate event to build or upgrade the unit and hides the menu.

##### public function `render()`

Returns `TemplateResult`. Renders the build menu UI with rows of build buttons, icons, names, descriptions, costs, and unit counts. Disabled buttons are styled appropriately.

##### public function `hideMenu()`

Returns `void`. Hides the build menu and triggers a render update.

##### public function `showMenu()`

| Parameter     | Type      | Description                            |
| ------------- | --------- | -------------------------------------- |
| `clickedTile` | `TileRef` | Tile that was clicked to open the menu |

Returns `void`. Shows the build menu at the clicked tile and refreshes available actions.

##### private function `refresh()`

Returns `void`. Updates `playerActions` for the clicked tile and filters the build table for enabled units.

##### private function `getBuildableUnits()`

Returns `BuildItemDisplay[][]`. Returns a filtered build table removing disabled units.

##### getter `isVisible`

Returns `boolean`. Returns `true` if the build menu is currently visible.

### ./layers/ChatDisplay.ts

#### interface `ChatEvent`

Represents a single chat message event in the display.

| Name                 | Type      | Description                                                       |
| -------------------- | --------- | ----------------------------------------------------------------- |
| `description`        | `string`  | The message content                                               |
| `unsafeDescription?` | `boolean` | Optional flag indicating whether HTML should be rendered unsafely |
| `createdAt`          | `number`  | Timestamp or tick count when the message was created              |
| `highlight?`         | `boolean` | Optional flag to highlight the message                            |

#### class `ChatDisplay`

Displays in-game chat messages and updates dynamically. Implements [interface `Layer`](#).

**Properties:**

| Name         | Type          | Description                                            |
| ------------ | ------------- | ------------------------------------------------------ |
| `eventBus`   | `EventBus`    | Event bus for receiving game and input events          |
| `game`       | `GameView`    | The game instance for accessing player and update data |
| `active`     | `boolean`     | Indicates whether the chat display is active           |
| `_hidden`    | `boolean`     | Internal state controlling visibility of the chat UI   |
| `newEvents`  | `number`      | Count of new chat events while hidden                  |
| `chatEvents` | `ChatEvent[]` | Array of chat events displayed in the chat UI          |

##### private function `toggleHidden()`

Returns `void`. Toggles `_hidden` state and resets `newEvents` if chat is being shown.

##### private function `addEvent()`

| Parameter | Type        | Description           |
| --------- | ----------- | --------------------- |
| `event`   | `ChatEvent` | The chat event to add |

Returns `void`. Adds a chat event to `chatEvents` and increments `newEvents` if hidden.

##### private function `removeEvent()`

| Parameter | Type     | Description                       |
| --------- | -------- | --------------------------------- |
| `index`   | `number` | Index of the chat event to remove |

Returns `void`. Removes the chat event at the given index.

##### public function `onDisplayMessageEvent()`

| Parameter | Type                   | Description                                           |
| --------- | ---------------------- | ----------------------------------------------------- |
| `event`   | `DisplayMessageUpdate` | Game update event containing chat message information |

Returns `void`. Adds a new chat event if it is of type `MessageType.CHAT` and relevant to the current player.

##### public function `init()`

Returns `void`. Placeholder for initialization logic.

##### public function `tick()`

Returns `void`. Processes game updates for display events, filters chat messages, trims to the last 100 messages, and triggers a render update.

##### private function `getChatContent()`

| Parameter | Type        | Description          |
| --------- | ----------- | -------------------- |
| `chat`    | `ChatEvent` | Chat event to render |

Returns `string | DirectiveResult<typeof UnsafeHTMLDirective>`. Returns sanitized HTML using `unsafeHTML` for messages marked as `unsafeDescription`, otherwise returns plain text.

##### public function `render()`

Returns `TemplateResult`. Renders the chat UI, including hide/show buttons, new event counter, and a table of chat messages. Handles CSS classes based on `_hidden` and `newEvents`.

##### public function `createRenderRoot()`

Returns `this`. Disables shadow DOM and renders directly into the host element.

### ./layers/ChatIntegration.ts

#### class `ChatIntegration`

Integrates quick chat and modal chat functionality for in-game communication.

**Properties:**

| Name       | Type        | Description                                      |
| ---------- | ----------- | ------------------------------------------------ |
| `ctModal`  | `ChatModal` | Reference to the chat modal DOM element          |
| `game`     | `GameView`  | The game instance used to determine player state |
| `eventBus` | `EventBus`  | Event bus for sending quick chat events          |

##### public constructor `constructor()`

| Parameter  | Type       | Description        |
| ---------- | ---------- | ------------------ |
| `game`     | `GameView` | Game instance      |
| `eventBus` | `EventBus` | Event bus instance |

Returns `ChatIntegration`. Initializes the chat modal and ensures the element exists in the DOM. Throws an error if the modal is missing.

##### public function `setupChatModal()`

| Parameter   | Type         | Description                        |
| ----------- | ------------ | ---------------------------------- |
| `sender`    | `PlayerView` | The player sending chat messages   |
| `recipient` | `PlayerView` | The player receiving chat messages |

Returns `void`. Sets the sender and recipient on the chat modal.

##### public function `createQuickChatMenu()`

| Parameter   | Type         | Description                                         |
| ----------- | ------------ | --------------------------------------------------- |
| `recipient` | `PlayerView` | The player who will receive the quick chat messages |

Returns `MenuElement[]`. Generates a hierarchical menu of quick chat phrases grouped by category. Each menu item contains display text, color, tooltip, and an action that either opens the chat modal or sends a quick chat event.

##### public function `shortenText()`

| Parameter    | Type     | Description                                           |
| ------------ | -------- | ----------------------------------------------------- |
| `text`       | `string` | The text string to shorten                            |
| `maxLength?` | `number` | Optional maximum length for the text. Defaults to 15. |

Returns `string`. Truncates the text and appends `...` if it exceeds `maxLength`.

### ./layers/ChatModal.ts

#### type `QuickChatPhrase`

Represents a single quick chat phrase.

| Property         | Type      | Description                                         |
| ---------------- | --------- | --------------------------------------------------- |
| `key`            | `string`  | Unique key identifier for the phrase                |
| `requiresPlayer` | `boolean` | Indicates if the phrase requires a player selection |

#### type `QuickChatPhrases`

Mapping of category IDs to arrays of `QuickChatPhrase`.

#### class `ChatModal`

Manages the chat modal UI, including phrase selection, player selection, and sending quick chat messages.

**Properties:**

| Name                      | Type                                                               | Description                                               |                                                             |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| `modalEl`                 | `HTMLElement` & { open: () => void; close: () => void; }           | Reference to the underlying modal element                 |                                                             |
| `players`                 | `PlayerView[]`                                                     | List of players available for quick chat selection        |                                                             |
| `playerSearchQuery`       | `string`                                                           | Current search query for filtering players                |                                                             |
| `previewText`             | `string                                                            | null`                                                     | Text preview of the selected phrase with substitutions      |
| `requiresPlayerSelection` | `boolean`                                                          | Indicates if the current phrase requires player selection |                                                             |
| `selectedCategory`        | `string                                                            | null`                                                     | ID of the currently selected category                       |
| `selectedPhraseText`      | `string                                                            | null`                                                     | Display text of the currently selected phrase               |
| `selectedPhraseTemplate`  | `string                                                            | null`                                                     | Template string of the selected phrase before substitutions |
| `selectedQuickChatKey`    | `string                                                            | null`                                                     | Full key of the selected phrase                             |
| `selectedPlayer`          | `PlayerView                                                        | null`                                                     | Player selected for substitution in the phrase              |
| `recipient`               | `PlayerView`                                                       | Player receiving the chat message                         |                                                             |
| `sender`                  | `PlayerView`                                                       | Player sending the chat message                           |                                                             |
| `eventBus`                | `EventBus`                                                         | Event bus used to emit `SendQuickChatEvent`s              |                                                             |
| `g`                       | `GameView`                                                         | Game instance for player information                      |                                                             |
| `quickChatPhrases`        | `Record<string, Array<{ text: string; requiresPlayer: boolean }>>` | Predefined phrases per category                           |                                                             |
| `categories`              | `Array<{ id: string }>`                                            | List of available chat categories                         |                                                             |

##### public function `initEventBus()`

| Parameter  | Type       | Description                                     |
| ---------- | ---------- | ----------------------------------------------- |
| `eventBus` | `EventBus` | Event bus instance to listen for CloseViewEvent |

Returns `void`. Sets up event listeners for modal closing.

##### public function `open()`

| Parameter    | Type         | Description                       |
| ------------ | ------------ | --------------------------------- |
| `sender?`    | `PlayerView` | Optional sender of the message    |
| `recipient?` | `PlayerView` | Optional recipient of the message |

Returns `void`. Opens the modal and initializes player list if sender and recipient are provided.

##### public function `close()`

Returns `void`. Resets modal state and closes the modal.

##### public function `setRecipient()`

| Parameter | Type         | Description                |
| --------- | ------------ | -------------------------- |
| `value`   | `PlayerView` | Player to set as recipient |

Returns `void`. Updates the recipient property.

##### public function `setSender()`

| Parameter | Type         | Description             |
| --------- | ------------ | ----------------------- |
| `value`   | `PlayerView` | Player to set as sender |

Returns `void`. Updates the sender property.

##### public function `openWithSelection()`

| Parameter    | Type         | Description                    |
| ------------ | ------------ | ------------------------------ |
| `categoryId` | `string`     | Category ID to preselect       |
| `phraseKey`  | `string`     | Key of the phrase to preselect |
| `sender?`    | `PlayerView` | Optional sender                |
| `recipient?` | `PlayerView` | Optional recipient             |

Returns `void`. Opens the modal with the given category and phrase selected.

##### private function `selectCategory()`

| Parameter    | Type     | Description                  |
| ------------ | -------- | ---------------------------- |
| `categoryId` | `string` | ID of the category to select |

Returns `void`. Updates modal state to reflect selected category.

##### private function `selectPhrase()`

| Parameter | Type              | Description      |
| --------- | ----------------- | ---------------- |
| `phrase`  | `QuickChatPhrase` | Phrase to select |

Returns `void`. Updates modal state with selected phrase and determines if player selection is required.

##### private function `selectPlayer()`

| Parameter | Type         | Description                             |
| --------- | ------------ | --------------------------------------- |
| `player`  | `PlayerView` | Player selected for phrase substitution |

Returns `void`. Updates modal state to include the selected player.

##### private function `sendChatMessage()`

Returns `void`. Emits a `SendQuickChatEvent` using the sender, recipient, selected phrase key, and optional selected player ID. Resets modal state.

##### private function `onPlayerSearchInput()`

| Parameter | Type    | Description                            |
| --------- | ------- | -------------------------------------- |
| `e`       | `Event` | Input event from the player search box |

Returns `void`. Updates the player search query and triggers re-render.

##### private function `getSortedFilteredPlayers()`

Returns `PlayerView[]`. Returns the list of players sorted alphabetically and filtered based on the current search query.

##### private function `getFullQuickChatKey()`

| Parameter   | Type     | Description |
| ----------- | -------- | ----------- |
| `category`  | `string` | Category ID |
| `phraseKey` | `string` | Phrase key  |

Returns `string`. Concatenates category and phrase key into a full quick chat key.

##### private function `renderPhrasePreview()`

| Parameter | Type              | Description   |
| --------- | ----------------- | ------------- |
| `phrase`  | `{ key: string }` | Phrase object |

Returns `string`. Returns the translated text of the phrase for preview purposes.

##### private function `getPhrasesForCategory()`

| Parameter    | Type     | Description |
| ------------ | -------- | ----------- |
| `categoryId` | `string` | Category ID |

Returns `QuickChatPhrase[]`. Returns the list of phrases for the given category.

render(): import("lit").TemplateResult

### ./layers/ControlPanel.ts

#### class `ControlPanel`

Represents the in-game control panel overlay, displaying troop counts, gold, and attack ratio. Implements [interface `Layer`](#interface-layer).

**Properties:**

| Name                     | Type       | Description                                                         |
| ------------------------ | ---------- | ------------------------------------------------------------------- |
| `game`                   | `GameView` | Reference to the current game view.                                 |
| `clientID`               | `ClientID` | Identifier for the client/player.                                   |
| `eventBus`               | `EventBus` | Event bus for listening and dispatching game events.                |
| `uiState`                | `UIState`  | Tracks the UI state, including attack ratio.                        |
| `attackRatio`            | `number`   | Current attack ratio (0–1). Managed with state decorator.           |
| `_maxTroops`             | `number`   | Maximum troops for the player. Managed with state decorator.        |
| `troopRate`              | `number`   | Rate of troop increase per tick. Managed with state decorator.      |
| `_troops`                | `number`   | Current number of troops. Managed with state decorator.             |
| `_isVisible`             | `boolean`  | Whether the control panel is visible. Managed with state decorator. |
| `_gold`                  | `Gold`     | Player's current gold. Managed with state decorator.                |
| `_troopRateIsIncreasing` | `boolean`  | Indicates if troop rate is increasing.                              |
| `_lastTroopIncreaseRate` | `number`   | Stores last tick's troop increase rate.                             |

##### public function `init()`

Returns `void`.

Initializes the control panel settings from local storage and sets up event listeners for attack ratio changes via [AttackRatioEvent](#class-attackratioevent). Updates the UI state when the attack ratio changes.

##### public function `tick()`

Returns `void`.

Updates the control panel each game tick. Shows or hides the panel based on player status, updates troop count, troop rate, maximum troops, and gold, and triggers a UI re-render. Calls [updateTroopIncrease()](#private-function-updatetroopincrease) every 5 ticks.

##### private function `updateTroopIncrease()`

Returns `void`.

Compares the current troop increase rate with the previous tick and updates `_troopRateIsIncreasing` to reflect whether it is increasing. Updates `_lastTroopIncreaseRate`.

##### public function `onAttackRatioChange()`

| Parameter  | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `newRatio` | `number` | The new attack ratio (0–1). |

Returns `void`.

Updates `uiState.attackRatio` to match `newRatio`.

##### public function `renderLayer()`

| Parameter | Type                       | Description                  |
| --------- | -------------------------- | ---------------------------- |
| `context` | `CanvasRenderingContext2D` | Canvas context to render on. |

Returns `void`.

Renders any necessary canvas elements for the control panel. Currently empty.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates whether the layer should apply canvas transformations. Returns `false`.

##### public function `setVisibile()`

| Parameter | Type      | Description                                  |
| --------- | --------- | -------------------------------------------- |
| `visible` | `boolean` | Whether the control panel should be visible. |

Returns `void`.

Sets `_isVisible` and requests a UI update.

##### public function `render()`

Returns `import("lit").TemplateResult`.

Renders the control panel HTML using [LitElement](https://lit.dev/) templating. Includes troop and gold display, attack ratio slider, and dynamic styling based on state variables.

##### public function `createRenderRoot()`

Returns `HTMLElement`.

Overrides `LitElement` method to disable shadow DOM, allowing global Tailwind CSS styling.

### ./layers/EmojiTable.ts

#### class `EmojiTable`

Displays a floating emoji selection table that can send emoji intents to players.

**Properties:**

| Name               | Type               | Description                                                   |
| ------------------ | ------------------ | ------------------------------------------------------------- |
| `isVisible`        | `boolean`          | Reactive state indicating whether the emoji table is visible. |
| `transformHandler` | `TransformHandler` | Handles screen-to-world coordinate transformations.           |
| `game`             | `GameView`         | The current game view instance.                               |

##### public function `initEventBus()`

| Parameter  | Type       | Description                                                    |
| ---------- | ---------- | -------------------------------------------------------------- |
| `eventBus` | `EventBus` | Event bus to listen for ShowEmojiMenuEvent and CloseViewEvent. |

Returns `void`. Registers event listeners to show or hide the emoji table and handle emoji selection. Handles validation of target player and tile ownership.

See also: [class `SendEmojiIntentEvent`](#), [class `TerraNulliusImpl`](#)

##### private property `onEmojiClicked`

| Name             | Type                      | Description                                                            |
| ---------------- | ------------------------- | ---------------------------------------------------------------------- |
| `onEmojiClicked` | `(emoji: string) => void` | Callback function invoked when an emoji is clicked. Initially a no-op. |

##### public function `render()`

Returns `TemplateResult | null`. Generates the HTML content for the emoji table using Lit `html`. Returns `null` if `isVisible` is false. Includes styling and event handlers for interaction.

##### public function `hideTable()`

Returns `void`. Hides the emoji table and requests a DOM update.

##### public function `showTable()`

| Parameter         | Type                      | Description                                 |
| ----------------- | ------------------------- | ------------------------------------------- |
| `oneEmojiClicked` | `(emoji: string) => void` | Callback executed when an emoji is clicked. |

Returns `void`. Shows the emoji table and assigns the click callback.

##### public function `createRenderRoot()`

Returns `HTMLElement`. Overrides LitElement behavior to disable shadow DOM and allow Tailwind CSS styling.

### ./layers/EventsDisplay.ts

#### class `EventsDisplay`

Manages the display of in-game events, chat messages, alliance updates, and attacks. Implements the `Layer` interface.

**Properties:**

| Name                  | Type                            | Description                                                  |                                        |
| --------------------- | ------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `eventBus`            | `EventBus`                      | Event bus for emitting and listening to game-related events. |                                        |
| `game`                | `GameView`                      | Current game view instance.                                  |                                        |
| `active`              | `boolean`                       | Indicates if the display is active.                          |                                        |
| `events`              | `GameEvent[]`                   | List of events currently shown in the display.               |                                        |
| `alliancesCheckedAt`  | `Map<number, Tick>`             | Tracks last checked tick for each alliance by ID.            |                                        |
| `incomingAttacks`     | `AttackUpdate[]`                | Tracks incoming attacks.                                     |                                        |
| `outgoingAttacks`     | `AttackUpdate[]`                | Tracks outgoing attacks.                                     |                                        |
| `outgoingLandAttacks` | `AttackUpdate[]`                | Tracks outgoing land-based attacks.                          |                                        |
| `outgoingBoats`       | `UnitView[]`                    | Tracks transport ship units.                                 |                                        |
| `_hidden`             | `boolean`                       | Whether the display is currently hidden.                     |                                        |
| `_isVisible`          | `boolean`                       | Visibility of the events display panel.                      |                                        |
| `newEvents`           | `number`                        | Counter for new events when hidden.                          |                                        |
| `latestGoldAmount`    | `bigint                         | null`                                                        | Tracks last gold change for animation. |
| `goldAmountAnimating` | `boolean`                       | Controls animation state for gold change.                    |                                        |
| `goldAmountTimeoutId` | `ReturnType<typeof setTimeout>  | null`                                                        | Timeout reference for gold animation.  |
| `eventsFilters`       | `Map<MessageCategory, boolean>` | Tracks which categories are filtered out.                    |                                        |

##### public function `init()`

Returns `void`. Initializes the layer (currently empty placeholder).

##### public function `tick()`

Returns `void`. Updates event display state, filters expired events, updates incoming/outgoing attacks, and requests UI update.

##### public function `disconnectedCallback()`

Returns `void`. Cleans up resources like gold animation timeout when the element is removed from DOM.

##### public function `shouldTransform()`

Returns `boolean`. Returns `false` to indicate this layer does not require coordinate transformation.

##### public function `renderLayer()`

Returns `void`. Placeholder for `Layer` interface; actual rendering is handled in `render()`.

##### private function `renderButton()`

| Parameter | Type     | Description                                                                                                                |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `options` | `object` | Options for rendering a button including content, click handler, CSS classes, disabled state, translation, and visibility. |

Returns `TemplateResult`. Generates a button with specified content and options.

##### private function `renderToggleButton()`

| Parameter  | Type              | Description                         |
| ---------- | ----------------- | ----------------------------------- |
| `src`      | `string`          | Image source for the toggle button. |
| `category` | `MessageCategory` | Event category to toggle.           |

Returns `TemplateResult`. Renders an event filter toggle button.

##### private function `toggleHidden()`

Returns `void`. Toggles the `_hidden` state and resets new events counter.

##### private function `toggleEventFilter()`

| Parameter    | Type              | Description                                    |
| ------------ | ----------------- | ---------------------------------------------- |
| `filterName` | `MessageCategory` | The category of events to toggle filter state. |

Returns `void`. Updates the event filter and refreshes display.

##### private function `checkForAllianceExpirations()`

Returns `void`. Checks player's alliances for imminent expiration and adds events to notify the player.

##### private function `addEvent()`

| Parameter | Type        | Description                         |
| --------- | ----------- | ----------------------------------- |
| `event`   | `GameEvent` | Event object to add to the display. |

Returns `void`. Adds the event to the display and increments new event counter if hidden.

##### private function `removeEvent()`

| Parameter | Type     | Description                   |
| --------- | -------- | ----------------------------- |
| `index`   | `number` | Index of the event to remove. |

Returns `void`. Removes the event at the given index.

##### Event Handlers (onXEvent)

Each `onXEvent` function handles a specific game update type and adds corresponding `GameEvent`s:

| Function                      | Parameter                    | Description                                       |
| ----------------------------- | ---------------------------- | ------------------------------------------------- |
| `onDisplayMessageEvent`       | `DisplayMessageUpdate`       | Handles standard messages including gold changes. |
| `onDisplayChatEvent`          | `DisplayChatMessageUpdate`   | Handles chat messages and formatting.             |
| `onAllianceRequestEvent`      | `AllianceRequestUpdate`      | Handles incoming alliance requests.               |
| `onAllianceRequestReplyEvent` | `AllianceRequestReplyUpdate` | Handles replies to alliance requests.             |
| `onBrokeAllianceEvent`        | `BrokeAllianceUpdate`        | Handles events where alliances are broken.        |
| `onAllianceExpiredEvent`      | `AllianceExpiredUpdate`      | Handles notifications of alliance expiration.     |
| `onTargetPlayerEvent`         | `TargetPlayerUpdate`         | Handles attack requests between players.          |
| `onEmojiMessageEvent`         | `EmojiUpdate`                | Handles emoji messages sent between players.      |
| `onUnitIncomingEvent`         | `UnitIncomingUpdate`         | Handles incoming unit attacks.                    |

##### Private helper functions for rendering

| Function                    | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `getEventDescription`       | Returns event description; uses `unsafeHTML` if `unsafeDescription` is true. |
| `attackWarningOnClick`      | Handles click on an incoming attack, navigating to attacker or position.     |
| `renderIncomingAttacks`     | Renders incoming attacks as buttons.                                         |
| `renderOutgoingAttacks`     | Renders outgoing attacks with cancel buttons.                                |
| `renderOutgoingLandAttacks` | Renders outgoing land attacks with cancel buttons.                           |
| `renderBoats`               | Renders transport units with cancel buttons.                                 |

##### public function `render()`

Returns `TemplateResult`. Renders the events panel including toggle buttons, events table, incoming/outgoing attacks, and animation effects.

##### public function `createRenderRoot()`

Returns `HTMLElement`. Disables shadow DOM to allow global styling (Tailwind CSS).

### ./layers/FPSDisplay.ts

#### class `FPSDisplay`

Displays a draggable FPS overlay, showing current FPS, 60-second average, and frame time. Implements the `Layer` interface.

**Properties:**

| Name           | Type                       | Description                                                       |
| -------------- | -------------------------- | ----------------------------------------------------------------- |
| `eventBus`     | `EventBus`                 | Event bus for listening to performance overlay toggle events.     |
| `userSettings` | `UserSettings`             | Stores user preferences including performance overlay visibility. |
| `currentFPS`   | `number`                   | Current FPS calculated from recent frame times.                   |
| `averageFPS`   | `number`                   | Average FPS over the last 60 seconds.                             |
| `frameTime`    | `number`                   | Duration of the last frame in milliseconds.                       |
| `isVisible`    | `boolean`                  | Indicates whether the FPS overlay is visible.                     |
| `isDragging`   | `boolean`                  | Indicates whether the overlay is being dragged.                   |
| `position`     | `{ x: number; y: number }` | Overlay position in pixels.                                       |

##### public function `init()`

Returns `void`. Registers an event listener for `TogglePerformanceOverlayEvent` to toggle performance overlay visibility in user settings.

##### public function `setVisible()`

| Parameter | Type      | Description                             |
| --------- | --------- | --------------------------------------- |
| `visible` | `boolean` | Whether the FPS overlay should be shown |

Returns `void`. Updates the visibility state.

##### private function `handleClose()`

Returns `void`. Handles click on the close button and toggles performance overlay in user settings.

##### private function `handleMouseDown()`

| Parameter | Type         | Description                               |
| --------- | ------------ | ----------------------------------------- |
| `e`       | `MouseEvent` | Mouse event triggered by user interaction |

Returns `void`. Initiates dragging unless the close button is clicked.

##### private function `handleMouseMove()`

| Parameter | Type       | Description                          |
| --------- | ---------- | ------------------------------------ |
| `e`       | MouseEvent | Mouse movement event during dragging |

Returns `void`. Updates the overlay position based on mouse movement, keeping it within viewport bounds.

##### private function `handleMouseUp()`

Returns `void`. Stops dragging and removes event listeners.

##### public function `updateFPS()`

| Parameter       | Type     | Description                        |
| --------------- | -------- | ---------------------------------- |
| `frameDuration` | `number` | Duration of the current frame (ms) |

Returns `void`. Updates current FPS, average FPS over 60 seconds, and frame time. Requests DOM update.

##### public function `shouldTransform()`

Returns `boolean`. Indicates whether the layer should be transformed; always returns `false`.

##### private function `getFPSColor()`

| Parameter | Type     | Description                  |
| --------- | -------- | ---------------------------- |
| `fps`     | `number` | FPS value to determine color |

Returns `string`. Returns a CSS class string based on FPS thresholds (`fps-good`, `fps-warning`, `fps-bad`).

##### public function `render()`

Returns `TemplateResult`. Generates HTML for the overlay with current FPS, average FPS, and frame time. Positions the overlay according to `position` and applies dragging style if `isDragging` is true.

### ./layers/FxLayer.ts

#### class `FxLayer`

Manages all visual effects (FX) on the game layer, including unit events, bonus events, nuke events, and environmental animations.

**Properties:**

| Name                   | Type                       | Description                                           |
| ---------------------- | -------------------------- | ----------------------------------------------------- |
| `canvas`               | `HTMLCanvasElement`        | The canvas used for rendering FX.                     |
| `context`              | `CanvasRenderingContext2D` | 2D rendering context for the FX canvas.               |
| `lastRandomEvent`      | `number`                   | Counter for random environmental FX.                  |
| `randomEventRate`      | `number`                   | Interval threshold for random FX events.              |
| `lastRefresh`          | `number`                   | Timestamp of the last FX layer refresh.               |
| `refreshRate`          | `number`                   | Interval threshold (ms) for redrawing FX.             |
| `theme`                | `Theme`                    | Current theme configuration.                          |
| `animatedSpriteLoader` | `AnimatedSpriteLoader`     | Loads and caches animated sprites.                    |
| `allFx`                | `Fx[]`                     | List of active FX instances.                          |
| `boatTargetFxByUnitId` | `Map<number, TargetFx>`    | Persistent FX markers for transport ships by unit ID. |
| `nukeTargetFxByUnitId` | `Map<number, NukeAreaFx>`  | Persistent FX markers for nukes by unit ID.           |

##### public constructor `constructor()`

| Parameter | Type       | Description                                 |
| --------- | ---------- | ------------------------------------------- |
| `game`    | `GameView` | The game instance this FX layer belongs to. |

Initializes the FX layer, sets the theme from the game configuration, and prepares internal state.

##### public function `shouldTransform()`

Returns `boolean`.

Determines whether the FX layer requires transformation; always returns `true`.

##### public function `tick()`

Returns `void`.

Updates the FX layer state. Processes random events, boat targets, and all pending game updates (units, bonus events, railroad events, conquest events). Skips processing if FX layer is disabled in user settings.

##### private function `manageBoatTargetFx()`

Returns `void`.

Removes FX markers for transport ships that have reached their target, retreated, or become inactive.

##### private function `createNukeTargetFxIfOwned()`

| Parameter | Type       | Description                                  |
| --------- | ---------- | -------------------------------------------- |
| `unit`    | `UnitView` | Unit to potentially assign a nuke target FX. |

Returns `void`.

Creates a persistent nuke target FX for the current player or teammates if the unit is active and owned by the player or same team.

##### public function `onBonusEvent()`

| Parameter | Type               | Description                       |
| --------- | ------------------ | --------------------------------- |
| `bonus`   | `BonusEventUpdate` | Bonus event update from the game. |

Returns `void`.

Displays textual FX for gold or troop bonuses for the current player only.

##### public function `addTextFx()`

| Parameter | Type     | Description      |
| --------- | -------- | ---------------- |
| `text`    | `string` | Text to display. |
| `x`       | `number` | X-coordinate.    |
| `y`       | `number` | Y-coordinate.    |

Returns `void`.

Adds a floating text FX at the specified location.

##### public function `randomEvent()`

Returns `void`.

Generates random environmental FX (Shark, Bubble, Tornado, Tentacle, MiniSmoke) at random ocean locations.

##### public function `onUnitEvent()`

| Parameter | Type       | Description         |
| --------- | ---------- | ------------------- |
| `unit`    | `UnitView` | Unit triggering FX. |

Returns `void`.

Dispatches FX handling based on the unit type (TransportShip, AtomBomb, MIRVWarhead, HydrogenBomb, Warship, Shell, Train, DefensePost, City, Port, MissileSilo, SAMLauncher, Factory).

##### public function `onShellEvent()`

| Parameter | Type       | Description |
| --------- | ---------- | ----------- |
| `unit`    | `UnitView` | Shell unit. |

Returns `void`.

Generates mini explosion FX for inactive shell units that reached their target.

##### public function `onTrainEvent()`

| Parameter | Type       | Description |
| --------- | ---------- | ----------- |
| `unit`    | `UnitView` | Train unit. |

Returns `void`.

Generates mini explosion FX for inactive trains that did not reach their target.

##### public function `onRailroadEvent()`

| Parameter  | Type             | Description            |
| ---------- | ---------------- | ---------------------- |
| `railroad` | `RailroadUpdate` | Railroad event update. |

Returns `void`.

Generates FX along railroad tiles based on a 1/3 chance per tile.

##### public function `onConquestEvent()`

| Parameter  | Type             | Description            |
| ---------- | ---------------- | ---------------------- |
| `conquest` | `ConquestUpdate` | Conquest event update. |

Returns `void`.

Displays FX and plays sound effect for conquests belonging to the current player.

##### public function `onWarshipEvent()`

| Parameter | Type       | Description   |
| --------- | ---------- | ------------- |
| `unit`    | `UnitView` | Warship unit. |

Returns `void`.

Generates explosion FX for inactive warships and adds a sinking ship sprite.

##### public function `onStructureEvent()`

| Parameter | Type       | Description     |
| --------- | ---------- | --------------- |
| `unit`    | `UnitView` | Structure unit. |

Returns `void`.

Adds building explosion FX for inactive structures.

##### public function `onNukeEvent()`

| Parameter | Type       | Description       |
| --------- | ---------- | ----------------- |
| `unit`    | `UnitView` | Nuclear unit.     |
| `radius`  | `number`   | Explosion radius. |

Returns `void`.

Handles nuke impact, removing FX markers, and delegating to SAM interception or nuke explosion handlers.

##### private function `handleNukeExplosion()`

| Parameter | Type       | Description       |
| --------- | ---------- | ----------------- |
| `unit`    | `UnitView` | Nuclear unit.     |
| `radius`  | `number`   | Explosion radius. |

Returns `void`.

Generates nuke explosion FX using `nukeFxFactory`.

##### private function `handleSAMInterception()`

| Parameter | Type       | Description                      |
| --------- | ---------- | -------------------------------- |
| `unit`    | `UnitView` | Nuclear unit intercepted by SAM. |

Returns `void`.

Generates SAM explosion and shockwave FX.

##### public async function `init()`

Returns `Promise<void>`.

Initializes FX layer canvas and loads all animated sprites.

##### public function `redraw()`

Returns `void`.

Prepares the canvas and context for rendering FX, disables image smoothing, and sets canvas dimensions to match the game.

##### public function `renderLayer()`

| Parameter | Type                       | Description                                |
| --------- | -------------------------- | ------------------------------------------ |
| `context` | `CanvasRenderingContext2D` | Rendering context of the main game canvas. |

Returns `void`.

Draws the FX layer onto the main game canvas if FX are enabled, refreshing periodically based on `refreshRate`.

##### private function `renderAllFx()`

| Parameter | Type                       | Description                  |
| --------- | -------------------------- | ---------------------------- |
| `context` | `CanvasRenderingContext2D` | Rendering context.           |
| `delta`   | `number`                   | Time since last render (ms). |

Returns `void`.

Clears the FX canvas and renders all active FX.

##### private function `renderContextFx()`

| Parameter  | Type     | Description                      |
| ---------- | -------- | -------------------------------- |
| `duration` | `number` | Duration since last render (ms). |

Returns `void`.

Iterates through all FX, updating and removing inactive ones.

### ./layers/GameLeftSidebar.ts

#### class `GameLeftSidebar`

Manages the left sidebar in the game UI, displaying player team labels, leaderboard, and team statistics. Implements the `Layer` interface.

**Properties:**

| Name                       | Type             | Description                                                      |
| -------------------------- | ---------------- | ---------------------------------------------------------------- |
| `isLeaderboardShow`        | `boolean`        | Indicates whether the leaderboard is visible.                    |
| `isTeamLeaderboardShow`    | `boolean`        | Indicates whether the team leaderboard is visible.               |
| `isVisible`                | `boolean`        | Indicates whether the sidebar is visible.                        |
| `isPlayerTeamLabelVisible` | `boolean`        | Indicates whether the player's team label is visible.            |
| `playerTeam`               | `string \| null` | Stores the player's team identifier.                             |
| `playerColor`              | `Colord`         | Color associated with the player's team.                         |
| `game`                     | `GameView`       | Game view instance for accessing player and game state.          |
| `_shownOnInit`             | `boolean`        | Tracks whether the sidebar was initially shown on large screens. |

#### public function `createRenderRoot()`

Returns `this`. Disables shadow DOM to allow global styles.

#### public function `init()`

Returns `void`. Initializes sidebar visibility, shows player team label if in a team game, and sets default visibility for large screens.

#### public function `tick()`

Returns `void`. Updates the sidebar state each game tick, including player team label, leaderboard visibility, and initial sidebar setup after spawn phase.

#### private function `toggleLeaderboard()`

Returns `void`. Toggles visibility of the main leaderboard.

#### private function `toggleTeamLeaderboard()`

Returns `void`. Toggles visibility of the team leaderboard.

#### private getter `isTeamGame()`

Returns `boolean`. Determines whether the current game mode is a team game.

#### private function `getTranslatedPlayerTeamLabel()`

Returns `string`. Retrieves the localized team label; falls back to the team identifier if no translation is found.

#### public function `render()`

Returns `TemplateResult`. Generates the sidebar HTML structure including team label, leaderboard buttons, and embedded leaderboard and team stats components. Applies dynamic visibility and styling based on state.

### ./layers/GameRightSidebar.ts

#### class `GameRightSidebar`

Manages the right sidebar in the game UI, including replay controls, pause/play functionality, timer display, settings, and exit actions. Implements the `Layer` interface.

**Properties:**

| Name               | Type       | Description                                              |
| ------------------ | ---------- | -------------------------------------------------------- |
| `game`             | `GameView` | Game view instance for accessing player and game state.  |
| `eventBus`         | `EventBus` | Event bus for emitting UI events.                        |
| `_isSinglePlayer`  | `boolean`  | Indicates whether the game is single-player or a replay. |
| `_isReplayVisible` | `boolean`  | Indicates whether the replay panel is visible.           |
| `_isVisible`       | `boolean`  | Indicates whether the sidebar is visible.                |
| `isPaused`         | `boolean`  | Indicates whether the game is paused.                    |
| `timer`            | `number`   | Tracks the game timer in seconds.                        |
| `hasWinner`        | `boolean`  | Tracks whether a winner has been determined.             |

#### public function `createRenderRoot()`

Returns `this`. Disables shadow DOM to allow global styles.

#### public function `init()`

Returns `void`. Initializes the sidebar, sets `_isSinglePlayer`, visibility, and spawn phase state.

#### public function `tick()`

Returns `void`. Updates timer logic, checks for game winner, and handles spawn phase adjustments.

#### private function `secondsToHms()`

| Parameter | Type     | Description                   |
| --------- | -------- | ----------------------------- |
| `d`       | `number` | Number of seconds to convert. |

Returns `string`. Converts seconds to a human-readable format (h, m, s). Uses `"-"` as fallback for zero.

#### private function `toggleReplayPanel()`

Returns `void`. Toggles visibility of the replay panel and emits `ShowReplayPanelEvent` with the updated state and `_isSinglePlayer` flag.

#### private function `onPauseButtonClick()`

Returns `void`. Toggles the paused state and emits a `PauseGameEvent`.

#### private function `onExitButtonClick()`

Returns `void`. Handles exit logic, including player confirmation if alive, then redirects to the home page.

#### private function `onSettingsButtonClick()`

Returns `void`. Emits `ShowSettingsModalEvent` to display settings panel.

#### public function `render()`

Returns `TemplateResult`. Renders the sidebar HTML, including replay, pause/play, settings, exit buttons, and game timer. Applies dynamic visibility and styling based on state.

#### private function `maybeRenderReplayButtons()`

Returns `TemplateResult`. Conditionally renders replay and pause/play buttons if `_isSinglePlayer` or the game is a replay.

### ./layers/HeadsUpMessage.ts

#### class `HeadsUpMessage`

Displays a temporary spawn selection message during the game's spawn phase.

**Properties:**

| Name        | Type       | Description                                                             |
| ----------- | ---------- | ----------------------------------------------------------------------- |
| `game`      | `GameView` | The current game view instance.                                         |
| `isVisible` | `boolean`  | Indicates whether the message is currently visible. Managed internally. |

##### public function `createRenderRoot()`

Returns `LitElement`.

Overrides LitElement's shadow DOM root creation to render into the light DOM, enabling external CSS styling.

##### public function `init()`

Returns `void`.

Initializes the message by making it visible and requesting an update to render.

##### public function `tick()`

Returns `void`.

Updates visibility based on the game state. Hides the message once the spawn phase ends.

##### public function `render()`

Returns `TemplateResult`.

Renders the message element if `isVisible` is `true`. Uses `translateText` to display a localized prompt: "choose_spawn".

**See also:** [Layer interface](#layer)

### ./layers/Layer.ts

#### interface `Layer`

Defines the lifecycle and rendering contract for all game layers. Layers can optionally implement these methods to manage state, rendering, and transformations.

**Optional Methods:**

| Name              | Type                                          | Description                                                                                                                      |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `init`            | `() => void`                                  | Optional initialization logic for the layer. Called once when the layer is first set up.                                         |
| `tick`            | `() => void`                                  | Optional per-frame update logic. Called every game tick.                                                                         |
| `renderLayer`     | `(context: CanvasRenderingContext2D) => void` | Optional rendering logic for the layer. Receives a canvas rendering context to draw to.                                          |
| `shouldTransform` | `() => boolean`                               | Optional indicator whether the layer should apply transformations like translation/scaling. Returns `true` or `false`.           |
| `redraw`          | `() => void`                                  | Optional method to refresh or re-initialize the layer's internal canvas or state. Called when the layer needs a complete redraw. |

**Usage:**

Layers implementing this interface are managed by the game's rendering system. Methods are all optional, allowing flexible layer implementations that only override necessary behaviors.

### ./layers/Leaderboard.ts

#### interface `Entry`

Represents a single player entry in the leaderboard.

| Name           | Type         | Description                                                  |
| -------------- | ------------ | ------------------------------------------------------------ |
| `name`         | `string`     | Player's display name                                        |
| `position`     | `number`     | Player's position on the leaderboard                         |
| `score`        | `string`     | Player's score as a formatted percentage                     |
| `gold`         | `string`     | Player's gold formatted as string                            |
| `troops`       | `string`     | Player's troops formatted as string                          |
| `isMyPlayer`   | `boolean`    | Whether the entry corresponds to the current player          |
| `isOnSameTeam` | `boolean`    | Whether the player is on the same team as the current player |
| `player`       | `PlayerView` | Reference to the PlayerView instance                         |

#### class `GoToPlayerEvent`

Implements `GameEvent`. Event to navigate to a specific player.

| Parameter | Type         | Description           |
| --------- | ------------ | --------------------- |
| `player`  | `PlayerView` | Player to navigate to |

Returns `void`.

#### class `GoToPositionEvent`

Implements `GameEvent`. Event to navigate to specific coordinates.

| Parameter | Type     | Description  |
| --------- | -------- | ------------ |
| `x`       | `number` | X-coordinate |
| `y`       | `number` | Y-coordinate |

Returns `void`.

#### class `GoToUnitEvent`

Implements `GameEvent`. Event to navigate to a specific unit.

| Parameter | Type       | Description         |
| --------- | ---------- | ------------------- |
| `unit`    | `UnitView` | Unit to navigate to |

Returns `void`.

#### class `Leaderboard`

Displays the game leaderboard and handles sorting, updating, and player navigation.

**Properties:**

| Name          | Type      | Description                            |                                                 |                  |
| ------------- | --------- | -------------------------------------- | ----------------------------------------------- | ---------------- |
| `game`        | `GameView | null`                                  | Current game view instance                      |                  |
| `eventBus`    | `EventBus | null`                                  | Event bus for emitting player navigation events |                  |
| `players`     | `Entry[]` | Array of leaderboard entries           |                                                 |                  |
| `visible`     | `boolean` | Whether the leaderboard is visible     |                                                 |                  |
| `showTopFive` | `boolean` | Flag to show only the top five players |                                                 |                  |
| `_sortKey`    | `'tiles'  | 'gold'                                 | 'troops'`                                       | Current sort key |
| `_sortOrder`  | `'asc'    | 'desc'`                                | Current sort order                              |                  |

##### public function `createRenderRoot()`

Returns `HTMLElement`. Overrides LitElement to use light DOM for Tailwind styling.

##### public function `init()`

Returns `void`. Placeholder initialization method.

##### public function `tick()`

Returns `void`. Updates the leaderboard every 10 ticks if visible.

##### private function `setSort()`

| Parameter | Type     | Description |           |                      |
| --------- | -------- | ----------- | --------- | -------------------- |
| `key`     | `'tiles' | 'gold'      | 'troops'` | Sorting key to apply |

Returns `void`. Updates the sort key and order, then refreshes the leaderboard.

##### private function `updateLeaderboard()`

Returns `void`. Computes the current leaderboard entries based on game state, sort order, and whether to show only top five. Ensures current player is included if not in top five.

See also: [interface `Entry`](#interface-entry)

##### private function `handleRowClickPlayer()`

| Parameter | Type         | Description                           |
| --------- | ------------ | ------------------------------------- |
| `player`  | `PlayerView` | Player clicked on the leaderboard row |

Returns `void`. Emits `GoToPlayerEvent` via the event bus.

##### public function `renderLayer()`

| Parameter | Type                       | Description              |
| --------- | -------------------------- | ------------------------ |
| `context` | `CanvasRenderingContext2D` | Canvas rendering context |

Returns `void`. Placeholder for rendering the leaderboard layer.

##### public function `shouldTransform()`

Returns `boolean`. Indicates whether the leaderboard layer requires canvas transformations. Always returns false.

##### public function `render()`

Returns `TemplateResult`. Renders the leaderboard HTML including header row, sortable columns, and entries. Handles clicks to sort and toggle top-five visibility.

#### private function `formatPercentage()`

| Parameter | Type     | Description                                   |
| --------- | -------- | --------------------------------------------- |
| `value`   | `number` | Value between 0 and 1 to format as percentage |

Returns `string`. Formats a number as a percentage string with one decimal place. Returns `0%` if the input is NaN.

### ./layers/MainRadialMenu.ts

#### class `MainRadialMenu`

Manages the main radial menu for player actions, including build menus, emoji table, chat integration, and UI updates.

**Properties:**

| Name                  | Type                  | Description                                                      |                                                     |
| --------------------- | --------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `radialMenu`          | `RadialMenu`          | Core radial menu instance handling menu display and interactions |                                                     |
| `playerActionHandler` | `PlayerActionHandler` | Handles player actions triggered from the radial menu            |                                                     |
| `chatIntegration`     | `ChatIntegration`     | Integrates chat functionality for interacting with other players |                                                     |
| `clickedTile`         | `TileRef              | null`                                                            | The last clicked tile for which the menu was opened |

##### constructor

| Parameter          | Type               | Description                                      |
| ------------------ | ------------------ | ------------------------------------------------ |
| `eventBus`         | `EventBus`         | Event bus for subscribing and emitting events    |
| `game`             | `GameView`         | Current game view instance                       |
| `transformHandler` | `TransformHandler` | Converts screen coordinates to world coordinates |
| `emojiTable`       | `EmojiTable`       | Reference to the emoji table component           |
| `buildMenu`        | `BuildMenu`        | Reference to the build menu component            |
| `uiState`          | `UIState`          | UI state management instance                     |
| `playerPanel`      | `PlayerPanel`      | Reference to the player panel component          |

Initializes the radial menu, player action handler, and chat integration.

##### public function `init()`

Returns `void`. Sets up the radial menu and subscribes to `ContextMenuEvent` to open the menu when the player right-clicks a valid tile.

##### private async function `updatePlayerActions()`

| Parameter  | Type            | Description                                          |
| ---------- | --------------- | ---------------------------------------------------- |
| `myPlayer` | `PlayerView`    | The current player                                   |
| `actions`  | `PlayerActions` | Available actions for the player on the clicked tile |
| `tile`     | `TileRef`       | The tile for which actions are computed              |
| `screenX?` | `number`        | Optional X coordinate for menu display               |
| `screenY?` | `number`        | Optional Y coordinate for menu display               |

Returns `Promise<void>`. Updates the radial menu parameters, chat modal, build menu, and emoji table based on the provided player actions and tile. Shows or refreshes the radial menu at the specified screen coordinates.

##### public async function `tick()`

Returns `Promise<void>`. Periodically refreshes the radial menu actions every 5 game ticks if the menu is visible.

##### public function `renderLayer()`

| Parameter | Type                       | Description              |
| --------- | -------------------------- | ------------------------ |
| `context` | `CanvasRenderingContext2D` | Canvas rendering context |

Returns `void`. Renders the radial menu layer onto the canvas.

##### public function `shouldTransform()`

Returns `boolean`. Indicates whether the radial menu layer requires canvas transformations.

##### public function `closeMenu()`

Returns `void`. Hides the radial menu, build menu, emoji table, and player panel if any are visible.

### ./layers/MultiTabModal.ts

#### class `MultiTabModal`

Displays a modal warning when multiple tabs are detected for the same player. Handles countdown, penalty display, and event dispatching.

**Properties:**

| Name                | Type               | Description                                         |                                        |
| ------------------- | ------------------ | --------------------------------------------------- | -------------------------------------- |
| `game`              | `GameView`         | Current game view instance                          |                                        |
| `detector`          | `MultiTabDetector` | Monitors multi-tab activity                         |                                        |
| `duration`          | `number`           | Duration of penalty in milliseconds (default: 5000) |                                        |
| `countdown`         | `number`           | Countdown in seconds for the modal display          |                                        |
| `isVisible`         | `boolean`          | Whether the modal is currently visible              |                                        |
| `fakeIp`            | `string`           | Fake IP displayed in the modal                      |                                        |
| `deviceFingerprint` | `string`           | Fake device fingerprint displayed in the modal      |                                        |
| `reported`          | `boolean`          | Whether the multi-tab violation is reported         |                                        |
| `intervalId`        | `number            | undefined`                                          | ID of the interval timer for countdown |

##### public function `createRenderRoot()`

Returns `HTMLElement`. Disables shadow DOM to allow Tailwind styling.

##### public function `tick()`

Returns `void`. Monitors multi-tab activity and shows the modal when detected, unless the game is in spawn phase, singleplayer, or dev environment.

##### public function `init()`

Returns `void`. Initializes fake IP, device fingerprint, and reported status.

##### private function `generateFakeIp()`

Returns `string`. Generates a random IP address in `xxx.xxx.xxx.xxx` format.

##### private function `generateDeviceFingerprint()`

Returns `string`. Generates a random 32-character hexadecimal device fingerprint.

##### public function `show()`

| Parameter  | Type     | Description                                   |
| ---------- | -------- | --------------------------------------------- |
| `duration` | `number` | Duration in milliseconds to display the modal |

Returns `void`. Shows the modal, starts the countdown timer, and requests a DOM update.

##### public function `hide()`

Returns `void`. Hides the modal, clears the countdown timer, dispatches `penalty-complete` event, and requests a DOM update.

##### public function `disconnectedCallback()`

Returns `void`. Ensures interval timer is cleared when the element is removed from the DOM.

##### public function `render()`

Returns `TemplateResult`. Renders the modal HTML including warning messages, fake IP and fingerprint, countdown timer, progress bar, and penalty information.

### ./layers/NameLayer.ts

#### class `RenderInfo`

Tracks rendering information for a player.

**Properties:**

| Name             | Type                            | Description                                           |                                                 |
| ---------------- | ------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `icons`          | `Map<string, HTMLImageElement>` | Maps icon identifiers to HTML image elements          |                                                 |
| `player`         | `PlayerView`                    | Player associated with this render info               |                                                 |
| `lastRenderCalc` | `number`                        | Timestamp of last render calculation                  |                                                 |
| `location`       | `Cell                           | null`                                                 | Last known screen location of the player's name |
| `fontSize`       | `number`                        | Current font size for rendering the name              |                                                 |
| `fontColor`      | `string`                        | Current font color for rendering the name             |                                                 |
| `element`        | `HTMLElement`                   | HTML element representing the player's name and icons |                                                 |

#### class `NameLayer` implements `Layer`

Manages the rendering of player names, flags, troops, and associated icons on a separate layer.

**Properties:**

| Name                | Type                | Description                                          |                                 |
| ------------------- | ------------------- | ---------------------------------------------------- | ------------------------------- |
| `canvas`            | `HTMLCanvasElement` | The canvas used for the layer                        |                                 |
| `lastChecked`       | `number`            | Last time the layer was checked for updates          |                                 |
| `renderCheckRate`   | `number`            | Frequency (ms) for checking renders                  |                                 |
| `renderRefreshRate` | `number`            | Minimum time (ms) between individual render updates  |                                 |
| `rand`              | `PseudoRandom`      | Random number generator for slight render variations |                                 |
| `renders`           | `RenderInfo[]`      | List of all active render info objects               |                                 |
| `seenPlayers`       | `Set<PlayerView>`   | Tracks players already initialized for rendering     |                                 |
| `firstPlace`        | `PlayerView         | null`                                                | Player currently in first place |
| `theme`             | `Theme`             | Current theme used for colors and fonts              |                                 |
| `userSettings`      | `UserSettings`      | User settings such as dark mode                      |                                 |
| `isVisible`         | `boolean`           | Determines if the layer should be visible            |                                 |

**Constructor Parameters:**

| Parameter          | Type               | Description                              |
| ------------------ | ------------------ | ---------------------------------------- |
| `game`             | `GameView`         | The game view instance                   |
| `transformHandler` | `TransformHandler` | Handles coordinate transforms            |
| `eventBus`         | `EventBus`         | Event bus for subscribing to game events |

##### public function `init()`

Returns `void`. Initializes the canvas, container, event listeners, and prepares the layer for rendering.

##### public function `tick()`

Returns `void`. Updates the render list with alive players, initializing new `RenderInfo` objects for unseen players.

##### public function `renderLayer()`

| Parameter    | Type                       | Description                                  |
| ------------ | -------------------------- | -------------------------------------------- |
| `mainContex` | `CanvasRenderingContext2D` | The main canvas context to draw the layer on |

Returns `void`. Positions the layer container, triggers rendering updates based on `renderCheckRate`, and draws the canvas onto the main context.

##### public function `shouldTransform()`

Returns `boolean`. Always returns `false`, indicating the layer does not require transform scaling.

##### public function `redraw()`

Returns `void`. Updates the theme colors.

#### private function `onAlternateViewChange()`

| Parameter | Type                 | Description                                      |
| --------- | -------------------- | ------------------------------------------------ |
| `event`   | `AlternateViewEvent` | Event indicating a change in alternate view mode |

Returns `void`. Updates `isVisible` and refreshes visibility for all rendered elements.

#### private function `updateElementVisibility()`

| Parameter | Type         | Description                                 |
| --------- | ------------ | ------------------------------------------- |
| `render`  | `RenderInfo` | Render info object to update visibility for |

Returns `void`. Hides or shows the HTML element based on player state, zoom scale, screen position, and visibility flags.

#### private function `createPlayerElement()`

| Parameter | Type         | Description                                  |
| --------- | ------------ | -------------------------------------------- |
| `player`  | `PlayerView` | Player for whom the element is being created |

Returns `HTMLDivElement`. Creates a new HTML element for displaying the player's name, flag, troops, and icons. Initializes it off-screen and hidden.

#### public function `renderPlayerInfo()`

| Parameter | Type         | Description                                  |
| --------- | ------------ | -------------------------------------------- |
| `render`  | `RenderInfo` | The render info object to update and display |

Returns `void`. Updates font size, color, positions, and icons for a player. Removes the element if the player is no longer alive or visible.

See also: [class `RenderInfo`](#class-renderinfo)

#### private function `createIconElement()`

| Parameter | Type      | Description                                    |
| --------- | --------- | ---------------------------------------------- |
| `src`     | `string`  | Source URL of the icon image                   |
| `size`    | `number`  | Pixel size of the icon                         |
| `id`      | `string`  | Identifier for the icon                        |
| `center?` | `boolean` | Optional. If true, centers the icon vertically |

Returns `HTMLImageElement`. Creates an icon element with appropriate size, data attributes, and optional centering.

### ./layers/PlayerActionHandler.ts

#### class `PlayerActionHandler`

Handles player action intents by emitting corresponding events through the `EventBus`.

**Constructor Parameters:**

| Parameter  | Type       | Description                                                          |
| ---------- | ---------- | -------------------------------------------------------------------- |
| `eventBus` | `EventBus` | Event bus used to emit player action events                          |
| `uiState`  | `UIState`  | User interface state for retrieving parameters such as attack ratios |

##### public function `getPlayerActions()`

| Parameter | Type         | Description                                        |
| --------- | ------------ | -------------------------------------------------- |
| `player`  | `PlayerView` | Player whose available actions are being retrieved |
| `tile`    | `TileRef`    | Tile to query actions on                           |

Returns `Promise<PlayerActions>`. Retrieves available actions for the player on the specified tile.

##### public function `handleAttack()`

| Parameter  | Type         | Description                  |                                  |
| ---------- | ------------ | ---------------------------- | -------------------------------- |
| `player`   | `PlayerView` | Player performing the attack |                                  |
| `targetId` | `string      | null`                        | Optional ID of the target player |

Returns `void`. Emits a `SendAttackIntentEvent` with the troop count calculated from the attack ratio.

##### public function `handleBoatAttack()`

| Parameter    | Type         | Description                       |                                         |
| ------------ | ------------ | --------------------------------- | --------------------------------------- |
| `player`     | `PlayerView` | Player performing the boat attack |                                         |
| `targetId`   | `PlayerID    | null`                             | Optional target player ID               |
| `targetTile` | `TileRef`    | Tile being attacked               |                                         |
| `spawnTile`  | `TileRef     | null`                             | Optional spawn tile for the boat attack |

Returns `void`. Emits a `SendBoatAttackIntentEvent` with calculated troop count.

##### public function `findBestTransportShipSpawn()`

| Parameter | Type         | Description                              |
| --------- | ------------ | ---------------------------------------- |
| `player`  | `PlayerView` | Player requesting a transport ship spawn |
| `tile`    | `TileRef`    | Tile to consider for spawning            |

Returns `Promise<TileRef | false>`. Finds the optimal transport ship spawn for the player at a given tile. Returns `false` if no valid spawn exists.

##### public function `handleSpawn()`

| Parameter | Type      | Description          |
| --------- | --------- | -------------------- |
| `tile`    | `TileRef` | Tile to spawn a unit |

Returns `void`. Emits a `SendSpawnIntentEvent` for the specified tile.

##### public function `handleAllianceRequest()`

| Parameter   | Type         | Description                           |
| ----------- | ------------ | ------------------------------------- |
| `player`    | `PlayerView` | Player sending the alliance request   |
| `recipient` | `PlayerView` | Player receiving the alliance request |

Returns `void`. Emits a `SendAllianceRequestIntentEvent`.

##### public function `handleBreakAlliance()`

| Parameter   | Type         | Description                             |
| ----------- | ------------ | --------------------------------------- |
| `player`    | `PlayerView` | Player breaking the alliance            |
| `recipient` | `PlayerView` | Player with whom the alliance is broken |

Returns `void`. Emits a `SendBreakAllianceIntentEvent`.

##### public function `handleTargetPlayer()`

| Parameter  | Type    | Description |                                  |
| ---------- | ------- | ----------- | -------------------------------- |
| `targetId` | `string | null`       | Optional ID of the target player |

Returns `void`. Emits a `SendTargetPlayerIntentEvent` if `targetId` is not null.

##### public function `handleDonateGold()`

| Parameter   | Type         | Description                        |
| ----------- | ------------ | ---------------------------------- |
| `recipient` | `PlayerView` | Player receiving the gold donation |

Returns `void`. Emits a `SendDonateGoldIntentEvent`.

##### public function `handleDonateTroops()`

| Parameter   | Type         | Description                         |
| ----------- | ------------ | ----------------------------------- |
| `recipient` | `PlayerView` | Player receiving the troop donation |

Returns `void`. Emits a `SendDonateTroopsIntentEvent`.

##### public function `handleEmbargo()`

| Parameter   | Type         | Description            |                                     |
| ----------- | ------------ | ---------------------- | ----------------------------------- |
| `recipient` | `PlayerView` | Player being embargoed |                                     |
| `action`    | `"start"     | "stop"`                | Action to start or stop the embargo |

Returns `void`. Emits a `SendEmbargoIntentEvent` with the specified action.

##### public function `handleEmoji()`

| Parameter      | Type        | Description                   |                                           |
| -------------- | ----------- | ----------------------------- | ----------------------------------------- |
| `targetPlayer` | `PlayerView | "AllPlayers"`                 | Player or all players receiving the emoji |
| `emojiIndex`   | `number`    | Index of the emoji being sent |                                           |

Returns `void`. Emits a `SendEmojiIntentEvent`.

##### public function `handleDeleteUnit()`

| Parameter | Type     | Description              |
| --------- | -------- | ------------------------ |
| `unitId`  | `number` | ID of the unit to delete |

Returns `void`. Emits a `SendDeleteUnitIntentEvent`.

### ./layers/PlayerInfoOverlay.ts

#### class `PlayerInfoOverlay`

Displays detailed information about players or units in an overlay. Integrates with [class `TransformHandler`](#class-transformhandler) and listens for mouse and context events to determine which information to display.

##### public property `game`

Type: `GameView`

The current game view instance.

##### public property `eventBus`

Type: `EventBus`

Event bus for subscribing to relevant events such as mouse movement and context menu actions.

##### public property `transform`

Type: `TransformHandler`

Handles coordinate transformations between screen and world space.

##### private state `_isInfoVisible`

Type: `boolean`

Tracks whether the overlay is currently visible.

##### private state `player`

Type: `PlayerView | null`

The currently hovered player. `null` if no player is hovered.

##### private state `playerProfile`

Type: `PlayerProfile | null`

Profile information of the hovered player, loaded asynchronously.

##### private state `unit`

Type: `UnitView | null`

The currently hovered unit. `null` if no unit is hovered.

##### public function `init()`

Initializes event listeners for mouse movements, context menus, and closing radial menus. Marks the overlay as active.

##### public function `hide()`

Hides the overlay and clears the currently displayed player and unit.

##### public function `maybeShow(x: number, y: number)`

| Parameter | Type     | Description                                |
| --------- | -------- | ------------------------------------------ |
| `x`       | `number` | X-coordinate of the mouse in screen space. |
| `y`       | `number` | Y-coordinate of the mouse in screen space. |

Displays player or unit info if the coordinates correspond to a valid tile or nearby unit.

##### public function `tick()`

Requests a UI update every tick.

##### public function `renderLayer(context: CanvasRenderingContext2D)`

| Parameter | Type                       | Description                              |
| --------- | -------------------------- | ---------------------------------------- |
| `context` | `CanvasRenderingContext2D` | The rendering context to draw the layer. |

Implements the [Layer](#class-layer) interface. Empty placeholder for compatibility.

##### public function `shouldTransform()`

Returns `boolean`. Always returns `false`.

##### public function `setVisible(visible: boolean)`

| Parameter | Type      | Description                                |
| --------- | --------- | ------------------------------------------ |
| `visible` | `boolean` | Determines whether the overlay is visible. |

Updates `_isInfoVisible` and requests a UI update.

##### private function `getRelationClass(relation: Relation)`

| Parameter  | Type       | Description                      |
| ---------- | ---------- | -------------------------------- |
| `relation` | `Relation` | Relation type of another player. |

Returns a Tailwind CSS class string for coloring relation indicators.

##### private function `getRelationName(relation: Relation)`

| Parameter  | Type       | Description                      |
| ---------- | ---------- | -------------------------------- |
| `relation` | `Relation` | Relation type of another player. |

Returns a translated text string describing the relation.

##### private function `displayUnitCount(player: PlayerView, type: UnitType, icon: string, description: string)`

| Parameter     | Type         | Description                               |
| ------------- | ------------ | ----------------------------------------- |
| `player`      | `PlayerView` | Player whose units are counted.           |
| `type`        | `UnitType`   | The type of unit to display.              |
| `icon`        | `string`     | Icon URL representing the unit type.      |
| `description` | `string`     | Translation key for the unit description. |

Returns a `TemplateResult` displaying the unit count, or an empty string if the unit type is disabled.

##### private function `allianceExpirationText(alliance: AllianceView)`

| Parameter  | Type           | Description                           |
| ---------- | -------------- | ------------------------------------- |
| `alliance` | `AllianceView` | Alliance object with expiration info. |

Returns a formatted string representing the remaining alliance duration.

##### private function `renderPlayerInfo(player: PlayerView)`

| Parameter | Type         | Description                |
| --------- | ------------ | -------------------------- |
| `player`  | `PlayerView` | Player to render info for. |

Returns a `TemplateResult` rendering the player's info, including flag, name, troops, gold, units, and alliance relations.

##### private function `renderUnitInfo(unit: UnitView)`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | Unit to render info for. |

Returns a `TemplateResult` rendering the unit's owner, type, and health.

##### protected function `createRenderRoot()`

Overrides the default LitElement render root to return `this`, disabling shadow DOM to allow global Tailwind styling.

### ./layers/PlayerPanel.ts

#### class `PlayerPanel`

Manages the display and interaction of a player panel, including resources, alliances, actions, and player-specific information.

Implements [interface `Layer`](#interface-layer).

**Properties:**

| Name                    | Type                           | Description                                                                  |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `g`                     | `GameView`                     | The game view instance used to query player and tile data.                   |
| `eventBus`              | `EventBus`                     | Event bus instance for emitting and subscribing to events.                   |
| `emojiTable`            | `EmojiTable`                   | Component for displaying emoji selection.                                    |
| `uiState`               | `UIState`                      | UI state manager for modal and panel interactions.                           |
| `actions`               | `PlayerActions \| null`        | Cached actions for the currently displayed player and tile.                  |
| `tile`                  | `TileRef \| null`              | Tile reference for the current panel.                                        |
| `_profileForPlayerId`   | `number \| null`               | Stores the player ID of the currently loaded profile.                        |
| `sendTarget`            | `PlayerView \| null`           | Player targeted for sending troops or gold. Optional, managed via state.     |
| `sendMode`              | `'troops' \| 'gold' \| 'none'` | Current send mode. Optional, managed via state.                              |
| `isVisible`             | `boolean`                      | Visibility state of the panel. Optional, managed via state.                  |
| `allianceExpiryText`    | `string \| null`               | Text representation of remaining alliance time. Optional, managed via state. |
| `allianceExpirySeconds` | `number \| null`               | Remaining alliance time in seconds. Optional, managed via state.             |
| `otherProfile`          | `PlayerProfile \| null`        | Profile information for the displayed player. Optional, managed via state.   |
| `ctModal`               | `ChatModal`                    | Chat modal component used to open chat windows.                              |

##### public function `createRenderRoot()`

Returns `this`.

Overrides LitElement method to use the component itself as the render root.

##### public function `initEventBus(eventBus: EventBus)`

| Parameter  | Type       | Description                                                  |
| ---------- | ---------- | ------------------------------------------------------------ |
| `eventBus` | `EventBus` | The event bus to initialize and listen for `CloseViewEvent`. |

Returns `void`.

Sets up a listener to hide the panel when a `CloseViewEvent` is emitted.

##### public function `init()`

Returns `void`.

Initializes the event bus for `MouseUpEvent` and queries the DOM for the `ChatModal` element.

##### public function `tick()`

Returns `Promise<void>`.

Updates the panel periodically, refreshing the target player's profile, actions, and alliance expiry.

##### public function `show(actions: PlayerActions, tile: TileRef)`

| Parameter | Type            | Description                              |
| --------- | --------------- | ---------------------------------------- |
| `actions` | `PlayerActions` | Actions available to the current player. |
| `tile`    | `TileRef`       | Tile reference for the panel display.    |

Returns `void`.

Sets panel state to visible and updates the display.

##### public function `hide()`

Returns `void`.

Hides the panel and resets send mode and target.

##### private function `handleClose(e: Event)`

| Parameter | Type    | Description                          |
| --------- | ------- | ------------------------------------ |
| `e`       | `Event` | Event triggered by the close button. |

Returns `void`.

Stops propagation and hides the panel.

##### private function `handleAllianceClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

| Parameter  | Type         | Description     |
| ---------- | ------------ | --------------- |
| `e`        | `Event`      | Click event.    |
| `myPlayer` | `PlayerView` | Current player. |
| `other`    | `PlayerView` | Target player.  |

Returns `void`.

Emits a [class `SendAllianceRequestIntentEvent`](#class-sendalliancerequestintentevent) and hides the panel.

##### private function `handleBreakAllianceClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

| Parameter  | Type         | Description     |
| ---------- | ------------ | --------------- |
| `e`        | `Event`      | Click event.    |
| `myPlayer` | `PlayerView` | Current player. |
| `other`    | `PlayerView` | Target player.  |

Returns `void`.

Emits a [class `SendBreakAllianceIntentEvent`](#class-sendbreakallianceintentevent) and hides the panel.

##### private function `openSendTroops(target: PlayerView)`

| Parameter | Type         | Description               |
| --------- | ------------ | ------------------------- |
| `target`  | `PlayerView` | Player to send troops to. |

Returns `void`.

Sets send target and mode to `troops`.

##### private function `openSendGold(target: PlayerView)`

| Parameter | Type         | Description             |
| --------- | ------------ | ----------------------- |
| `target`  | `PlayerView` | Player to send gold to. |

Returns `void`.

Sets send target and mode to `gold`.

##### private function `handleDonateTroopClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

| Parameter  | Type         | Description     |
| ---------- | ------------ | --------------- |
| `e`        | `Event`      | Click event.    |
| `myPlayer` | `PlayerView` | Current player. |
| `other`    | `PlayerView` | Target player.  |

Returns `void`.

Opens the send troops modal.

##### private function `handleDonateGoldClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

| Parameter  | Type         | Description     |
| ---------- | ------------ | --------------- |
| `e`        | `Event`      | Click event.    |
| `myPlayer` | `PlayerView` | Current player. |
| `other`    | `PlayerView` | Target player.  |

Returns `void`.

Opens the send gold modal.

##### private function `closeSend()`

Returns `void`.

Resets the send target and send mode to `none`.

##### private function `confirmSend(e: CustomEvent<{ amount: number; closePanel?: boolean }>)`

| Parameter | Type                                                    | Description                                                   |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `e`       | `CustomEvent<{ amount: number; closePanel?: boolean }>` | Event containing amount to send and optional closePanel flag. |

Returns `void`.

Confirms sending resources, closes send modal, optionally hides panel.

##### private function `handleEmbargoClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

Emits [class `SendEmbargoIntentEvent`](#class-sendembargointentevent) to start embargo and hides the panel.

##### private function `handleStopEmbargoClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

Emits [class `SendEmbargoIntentEvent`](#class-sendembargointentevent) to stop embargo and hides the panel.

##### private function `onStopTradingAllClick(e: Event)`

Emits [class `SendEmbargoAllIntentEvent`](#class-sendembargoallintentevent) to start embargo with all players.

##### private function `onStartTradingAllClick(e: Event)`

Emits [class `SendEmbargoAllIntentEvent`](#class-sendembargoallintentevent) to stop embargo with all players.

##### private function `handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView)`

Displays emoji table, emits [class `SendEmojiIntentEvent`](#class-sendemojiintentevent) for selected emoji, hides panel.

##### private function `handleChat(e: Event, sender: PlayerView, other: PlayerView)`

Opens [class `ChatModal`](#class-chatmodal) for conversation between players.

##### private function `handleTargetClick(e: Event, other: PlayerView)`

Emits [class `SendTargetPlayerIntentEvent`](#class-sendtargetplayerintentevent) and hides panel.

##### private function `identityChipProps(type: PlayerType)`

| Parameter | Type         | Description                             |
| --------- | ------------ | --------------------------------------- |
| `type`    | `PlayerType` | Type of player (Human, Bot, FakeHuman). |

Returns `Object` with label, aria, classes, and icon for identity chip.

##### private function `getRelationClass(relation: Relation)`

| Parameter  | Type       | Description                           |
| ---------- | ---------- | ------------------------------------- |
| `relation` | `Relation` | Relation type to determine CSS class. |

Returns `string` CSS class for relation pill.

##### private function `getRelationName(relation: Relation)`

Returns `string` localized relation name.

##### private function `getExpiryColorClass(seconds: number \| null)`

Returns `string` CSS color class based on remaining seconds for alliance expiry.

##### private function `getTraitorRemainingSeconds(player: PlayerView)`

Returns `number \| null`. Remaining traitor time in seconds. Returns `null` if player is not traitor or no remaining ticks.

##### private function `renderTraitorBadge(other: PlayerView)`

Returns `TemplateResult`. HTML template for displaying traitor badge with remaining time.

##### private function `renderRelationPillIfNation(other: PlayerView, my: PlayerView)`

Returns `TemplateResult`. HTML template showing relation pill if player is a nation.

##### private function `renderIdentityRow(other: PlayerView, my: PlayerView)`

Returns `TemplateResult`. HTML template for player's flag, name, type chip, traitor badge, and relation pill.

##### private function `renderResources(other: PlayerView)`

Returns `TemplateResult`. HTML template displaying player's gold and troops.

##### private function `renderStats(other: PlayerView, my: PlayerView)`

Returns `TemplateResult`. HTML template showing betrayals and trading status.

##### private function `renderAlliances(other: PlayerView)`

Returns `TemplateResult`. HTML template listing all allies of the player.

##### private function `renderAllianceExpiry()`

Returns `TemplateResult`. HTML template showing remaining alliance time with color-coded urgency.

##### private function `renderActions(my: PlayerView, other: PlayerView)`

Returns `TemplateResult`. HTML template rendering all possible actions based on current state and permissions.

##### public function `render()`

Returns `TemplateResult`.

Renders the complete player panel including identity, resources, stats, alliances, alliance expiry, and action buttons. Hides panel if `isVisible` is false or tile has no player owner.

### ./layers/RadialMenu.ts

#### class `CloseRadialMenuEvent`

Event emitted to signal that a `RadialMenu` has been closed.

##### constructor `CloseRadialMenuEvent()`

Initializes a new instance of `CloseRadialMenuEvent`.

#### interface `TooltipItem`

Defines a tooltip text entry.

**Properties:**

| Name        | Type     | Description                               |
| ----------- | -------- | ----------------------------------------- |
| `text`      | `string` | The text to display in the tooltip.       |
| `className` | `string` | CSS class applied to the tooltip element. |

#### interface `RadialMenuConfig`

Configuration options for a `RadialMenu` instance.

**Properties:**

| Name                      | Type     | Description                                           |
| ------------------------- | -------- | ----------------------------------------------------- |
| `menuSize?`               | `number` | Optional. Base size of the menu in pixels.            |
| `submenuScale?`           | `number` | Optional. Scale factor applied to nested submenus.    |
| `centerButtonSize?`       | `number` | Optional. Radius of the central button.               |
| `iconSize?`               | `number` | Optional. Default size of menu icons.                 |
| `centerIconSize?`         | `number` | Optional. Size of the icon on the center button.      |
| `disabledColor?`          | `string` | Optional. Color applied to disabled menu items.       |
| `menuTransitionDuration?` | `number` | Optional. Duration of animations in milliseconds.     |
| `mainMenuInnerRadius?`    | `number` | Optional. Inner radius of the main menu.              |
| `centerButtonIcon?`       | `string` | Optional. URL or path to the center button icon.      |
| `maxNestedLevels?`        | `number` | Optional. Maximum allowed submenu depth.              |
| `innerRadiusIncrement?`   | `number` | Optional. Increase of inner radius per submenu level. |
| `tooltipStyle?`           | `string` | Optional. Custom CSS styles for tooltips.             |

#### class `RadialMenu` implements `Layer`

Manages interactive radial menus with multiple nested levels, central button actions, and tooltips.

**Properties:**

| Name                       | Type                                                                   | Description                                            |                                                     |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `menuElement`              | `d3.Selection<HTMLDivElement, unknown, null, undefined>`               | The container `div` holding the menu SVG.              |                                                     |
| `tooltipElement`           | `HTMLDivElement                                                        | null`                                                  | The DOM element used for displaying tooltips.       |
| `isVisible`                | `boolean`                                                              | Indicates whether the menu is currently displayed.     |                                                     |
| `currentLevel`             | `number`                                                               | Current menu level (0 = main menu).                    |                                                     |
| `menuStack`                | `MenuElement[][]`                                                      | Stack of previous menu levels for navigation.          |                                                     |
| `currentMenuItems`         | `MenuElement[]`                                                        | Currently active menu items.                           |                                                     |
| `config`                   | `Required<RadialMenuConfig>`                                           | Effective configuration object with defaults applied.  |                                                     |
| `backIconSize`             | `number`                                                               | Computed size of the back button icon.                 |                                                     |
| `centerButtonState`        | `"default"                                                             | "back"`                                                | Current state of the center button.                 |
| `isTransitioning`          | `boolean`                                                              | True when a menu animation is in progress.             |                                                     |
| `lastHideTime`             | `number`                                                               | Timestamp of last menu hide event.                     |                                                     |
| `reopenCooldownMs`         | `number`                                                               | Minimum interval before reopening the menu.            |                                                     |
| `anchorX`                  | `number`                                                               | X-coordinate for menu center positioning.              |                                                     |
| `anchorY`                  | `number`                                                               | Y-coordinate for menu center positioning.              |                                                     |
| `menuGroups`               | `Map<number, d3.Selection<SVGGElement, unknown, null, undefined>>`     | Group elements for each menu level.                    |                                                     |
| `menuPaths`                | `Map<string, d3.Selection<SVGPathElement, unknown, null, undefined>>`  | Mapping of menu item IDs to their SVG paths.           |                                                     |
| `menuIcons`                | `Map<string, d3.Selection<SVGImageElement, unknown, null, undefined>>` | Mapping of menu item IDs to their icons/text elements. |                                                     |
| `selectedItemId`           | `string                                                                | null`                                                  | ID of the currently selected menu item.             |
| `submenuHoverTimeout`      | `number                                                                | null`                                                  | Timeout ID for submenu hover delay.                 |
| `backButtonHoverTimeout`   | `number                                                                | null`                                                  | Timeout ID for back button hover delay.             |
| `navigationInProgress`     | `boolean`                                                              | True if a submenu navigation animation is active.      |                                                     |
| `originalCenterButtonIcon` | `string`                                                               | Stored reference to the original center button icon.   |                                                     |
| `params`                   | `MenuElementParams                                                     | null`                                                  | Current runtime parameters applied to menu actions. |

##### constructor `RadialMenu(eventBus: EventBus, rootMenu: MenuElement, centerButtonElement: CenterButtonElement, config?: RadialMenuConfig)`

| Parameter             | Type                  | Description                              |
| --------------------- | --------------------- | ---------------------------------------- |
| `eventBus`            | `EventBus`            | Event bus used for emitting menu events. |
| `rootMenu`            | `MenuElement`         | The top-level menu item structure.       |
| `centerButtonElement` | `CenterButtonElement` | The central button for menu actions.     |
| `config?`             | `RadialMenuConfig`    | Optional configuration overrides.        |

Initializes a new `RadialMenu` instance and applies default configuration values.

##### public function `init()`

Returns `void`.

Initializes the menu by creating DOM elements and subscribing to close events.

##### public function `showRadialMenu(x: number, y: number)`

| Parameter | Type     | Description                  |
| --------- | -------- | ---------------------------- |
| `x`       | `number` | X-coordinate of menu center. |
| `y`       | `number` | Y-coordinate of menu center. |

Returns `void`.

Displays the menu at the specified position if reopening is allowed.

##### public function `hideRadialMenu()`

Returns `void`.

Hides the menu, clears hover states, tooltips, and cached elements. Updates `lastHideTime`.

##### public function `disableAllButtons()`

Returns `void`.

Disables all current menu items and resets the center button state.

##### public function `updateCenterButtonState(state: CenterButtonState)`

| Parameter | Type                | Description                                        |
| --------- | ------------------- | -------------------------------------------------- |
| `state`   | `CenterButtonState` | New center button state (`"default"` or `"back"`). |

Returns `void`.

Updates visual state and interactivity of the center button.

##### public function `isMenuVisible()`

Returns `boolean`.

Indicates whether the radial menu is currently visible.

##### public function `getCurrentLevel()`

Returns `number`.

Returns the current active menu level.

##### public function `setParams(params: MenuElementParams)`

| Parameter | Type                | Description                                       |
| --------- | ------------------- | ------------------------------------------------- |
| `params`  | `MenuElementParams` | Parameters to be used for menu actions and state. |

Returns `void`.

Sets runtime parameters for menu behavior.

##### public function `refreshMenu()`

Returns `void`.

Redraws the current menu level if the menu is visible.

##### public function `refresh()`

Returns `void`.

Refreshes all menu items, updating disabled states, icons, and cooldowns based on current parameters.

##### public function `renderLayer(context: CanvasRenderingContext2D)`

| Parameter | Type                       | Description                          |
| --------- | -------------------------- | ------------------------------------ |
| `context` | `CanvasRenderingContext2D` | Canvas rendering context (not used). |

Returns `void`.

Implements `Layer` interface. Canvas rendering not required.

##### public function `shouldTransform()`

Returns `boolean`.

Always returns `false`. Implements `Layer` interface.

---

### ./layers/RadialMenuElements.ts

#### interface `MenuElementParams`

Parameters passed to [MenuElement](#interface-menuelement) handlers and submenus.

**Properties:**

| Name                  | Type                  | Description                                         |                              |
| --------------------- | --------------------- | --------------------------------------------------- | ---------------------------- |
| `myPlayer`            | `PlayerView`          | The current player.                                 |                              |
| `selected`            | `PlayerView           | null`                                               | The selected player, if any. |
| `tile`                | `TileRef`             | The tile reference associated with the menu action. |                              |
| `playerActions`       | `PlayerActions`       | Current player actions.                             |                              |
| `game`                | `GameView`            | Current game state.                                 |                              |
| `buildMenu`           | `BuildMenu`           | Build menu instance.                                |                              |
| `emojiTable`          | `EmojiTable`          | Emoji table instance.                               |                              |
| `playerActionHandler` | `PlayerActionHandler` | Handles player actions.                             |                              |
| `playerPanel`         | `PlayerPanel`         | Player panel UI handler.                            |                              |
| `chatIntegration`     | `ChatIntegration`     | Handles chat menu generation.                       |                              |
| `eventBus`            | `EventBus`            | Event bus for emitting and listening to events.     |                              |
| `closeMenu`           | `() => void`          | Callback to close the menu.                         |                              |

---

#### interface `MenuElement`

Represents a single element in a radial or sub-menu.

**Properties:**

| Name            | Type                                                  | Description                                                                                                |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | `string`                                              | Unique identifier of the menu element.                                                                     |
| `name`          | `string`                                              | Display name or internal key.                                                                              |
| `displayed?`    | `boolean \| ((params: MenuElementParams) => boolean)` | Optional. Determines whether the element is displayed. Can be a boolean or a function returning a boolean. |
| `color?`        | `string`                                              | Optional. Color of the element.                                                                            |
| `icon?`         | `string`                                              | Optional. Icon image path.                                                                                 |
| `text?`         | `string`                                              | Optional. Text to display on the element.                                                                  |
| `fontSize?`     | `string`                                              | Optional. Font size for `text`.                                                                            |
| `tooltipItems?` | `TooltipItem[]`                                       | Optional. Tooltip items for the element.                                                                   |
| `tooltipKeys?`  | `TooltipKey[]`                                        | Optional. Tooltip keys for localization.                                                                   |
| `cooldown?`     | `(params: MenuElementParams) => number`               | Optional. Returns cooldown value for the element.                                                          |
| `disabled`      | `(params: MenuElementParams) => boolean`              | Determines if the element is disabled.                                                                     |
| `action?`       | `(params: MenuElementParams) => void`                 | Optional. Action executed when the element is activated.                                                   |
| `subMenu?`      | `(params: MenuElementParams) => MenuElement[]`        | Optional. Returns submenu elements if the element has children.                                            |

---

#### interface `TooltipKey`

Represents a key used to generate tooltips.

**Properties:**

| Name        | Type                               | Description                                             |
| ----------- | ---------------------------------- | ------------------------------------------------------- |
| `key`       | `string`                           | Localization key for tooltip.                           |
| `className` | `string`                           | CSS class for styling the tooltip.                      |
| `params?`   | `Record<string, string \| number>` | Optional. Parameters for localized string substitution. |

---

#### interface `CenterButtonElement`

Special element representing the center button of a radial menu.

**Properties:**

| Name       | Type                                     | Description                                        |
| ---------- | ---------------------------------------- | -------------------------------------------------- |
| `disabled` | `(params: MenuElementParams) => boolean` | Determines if the center button is disabled.       |
| `action`   | `(params: MenuElementParams) => void`    | Action executed when the center button is pressed. |

---

#### constant `COLORS`

Color configuration for menu elements and tooltips.

**Properties:**

| Name          | Type     | Description                     |
| ------------- | -------- | ------------------------------- |
| `build`       | `string` | Build color `#ebe250`.          |
| `building`    | `string` | Building color `#2c2c2c`.       |
| `boat`        | `string` | Boat color `#3f6ab1`.           |
| `ally`        | `string` | Ally action color `#53ac75`.    |
| `breakAlly`   | `string` | Break alliance color `#c74848`. |
| `delete`      | `string` | Delete action color `#ff0000`.  |
| `info`        | `string` | Info color `#64748B`.           |
| `target`      | `string` | Target action color `#ff0000`.  |
| `attack`      | `string` | Attack color `#ff0000`.         |
| `infoDetails` | `string` | Detailed info color `#7f8c8d`.  |
| `infoEmoji`   | `string` | Emoji info color `#f1c40f`.     |
| `trade`       | `string` | Trade action color `#008080`.   |
| `embargo`     | `string` | Embargo action color `#6600cc`. |
| `tooltip`     | `object` | Nested tooltip colors.          |
| `chat`        | `object` | Nested chat message colors.     |

---

#### enum `Slot`

Predefined radial menu slots.

| Name     | Value      |
| -------- | ---------- |
| `Info`   | `"info"`   |
| `Boat`   | `"boat"`   |
| `Build`  | `"build"`  |
| `Attack` | `"attack"` |
| `Ally`   | `"ally"`   |
| `Back`   | `"back"`   |
| `Delete` | `"delete"` |

---

#### public function `getAllEnabledUnits(myPlayer: boolean, config: Config)`

Returns `Set<UnitType>`.

Returns all enabled units depending on whether it is for the current player or other players, filtered by `config.isUnitDisabled()`.

##### Behavior

- Adds specific structure and unit types depending on `myPlayer`. |
- Checks `config` for disabled units.

---

#### public function `createMenuElements(params: MenuElementParams, filterType: "attack" | "build", elementIdPrefix: string)`

Returns `MenuElement[]`.

Generates menu elements for attack or build submenus.

**Parameters:**

| Parameter         | Type                | Description                    |                         |
| ----------------- | ------------------- | ------------------------------ | ----------------------- |
| `params`          | `MenuElementParams` | Context parameters.            |                         |
| `filterType`      | `"attack"           | "build"`                       | Type of menu to create. |
| `elementIdPrefix` | `string`            | Prefix used for element `id`s. |                         |

##### Behavior

- Filters `flattenedBuildTable` based on `unitTypes` and `filterType`.
- Sets `disabled`, `color`, `icon`, and `tooltipItems` for each element.
- Assigns an `action` that builds or upgrades units and closes the menu. |

---

#### All exported `MenuElement` constants

Each follows the pattern:

- **Properties:** `id`, `name`, `disabled`, `color`, `icon`, optional `text`, `tooltipItems`, `tooltipKeys`.
- **Optional methods:** `action`, `subMenu`.

**Exported Elements:**

- `infoMenuElement` — Info button. Disabled if no selected player or in spawn phase.
- `attackMenuElement` — Attack submenu. Disabled in spawn phase. Calls `createMenuElements` with `filterType="attack"`.
- `buildMenuElement` — Build submenu. Disabled in spawn phase. Calls `createMenuElements` with `filterType="build"`.
- `boatMenuElement` — Boat action. Disabled if transport ship unavailable. Action is async.
- `deleteUnitElement` — Delete unit. Disabled based on ownership, land status, cooldown, and selection radius.
- `rootMenuElement` — Root menu aggregating info, build/attack, ally, delete, and boat elements based on conditions.

##### Example: `deleteUnitElement` action behavior

- Filters units within `DELETE_SELECTION_RADIUS`.
- Sorts by Manhattan distance.
- Calls `playerActionHandler.handleDeleteUnit()` for the closest unit.
- Calls `closeMenu()`.

---

#### exported `CenterButtonElement` constant

Represents the center button in the radial menu.

**Properties:**

| Name       | Type                                     | Description                                                                                      |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `disabled` | `(params: MenuElementParams) => boolean` | Returns true if the tile is water, in spawn phase with other player, or if `canAttack` is false. |
| `action`   | `(params: MenuElementParams) => void`    | Executes `handleSpawn` if in spawn phase, otherwise `handleAttack`. Closes the menu afterwards.  |

### ./layers/RailroadLayer.ts

#### class `RailroadLayer`

Handles rendering, color management, and updating of railroad tiles within the game view. Implements [interface `Layer`](#class-layer).

**Properties:**

| Name                   | Type                       | Description                                               |
| ---------------------- | -------------------------- | --------------------------------------------------------- |
| `canvas`               | `HTMLCanvasElement`        | Offscreen canvas used to draw the railroad layer.         |
| `context`              | `CanvasRenderingContext2D` | 2D drawing context of the `canvas`.                       |
| `theme`                | `Theme`                    | Theme configuration used for colorizing elements.         |
| `existingRailroads`    | `Map<TileRef, RailRef>`    | Tracks active rail tiles and their metadata.              |
| `nextRailIndexToCheck` | `number`                   | Index for iterating tiles to update colors incrementally. |
| `railTileList`         | `TileRef[]`                | List of tiles currently containing railroads.             |
| `game`                 | `GameView`                 | Reference to the current game view instance.              |
| `transformHandler`     | `TransformHandler`         | Manages scaling and transformations for rendering.        |

##### public constructor `constructor(game: GameView, transformHandler: TransformHandler)`

| Parameter          | Type               | Description                                          |
| ------------------ | ------------------ | ---------------------------------------------------- |
| `game`             | `GameView`         | The active game view to render railroads for.        |
| `transformHandler` | `TransformHandler` | Handles scaling and transformation during rendering. |

Initializes the `theme` from the game configuration.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates that this layer should be affected by transformations (scaling, translation) during rendering.

##### public function `tick()`

Returns `void`.

Processes railroad updates received since the last tick, delegating each to [private function `handleRailroadRendering()`](#private-function-handlerailroadrendering).

##### public function `updateRailColors()`

Returns `void`.

Incrementally updates rail colors based on ownership changes. Processes a maximum of `railTileList.length / 60` tiles per call to prevent performance spikes. Updates ownership in `existingRailroads` and repaints affected tiles using [function `paintRail()`](#public-function-paintrail).

##### public function `init()`

Returns `void`.

Initializes the layer by calling [function `redraw()`](#public-function-redraw).

##### public function `redraw()`

Returns `void`.

Recreates the offscreen canvas and repaints all rail tiles in `existingRailroads`. Enables smooth scaling for better visual quality. Throws an error if 2D context is not supported.

##### public function `renderLayer(context: CanvasRenderingContext2D)`

| Parameter | Type                       | Description                                |
| --------- | -------------------------- | ------------------------------------------ |
| `context` | `CanvasRenderingContext2D` | Context to render the railroad layer onto. |

Returns `void`.

Draws the offscreen canvas onto the given `context`, applying transparency proportional to the current `transformHandler.scale`. Ensures proper alpha blending for smooth zoom transitions.

##### private function `handleRailroadRendering(railUpdate: RailroadUpdate)`

| Parameter    | Type             | Description                                                        |
| ------------ | ---------------- | ------------------------------------------------------------------ |
| `railUpdate` | `RailroadUpdate` | Update data containing the railroad tiles and their active status. |

Returns `void`.

For each tile in `railUpdate.railTiles`, either paints or clears the railroad depending on `railUpdate.isActive`.

See also: [private function `paintRailroad()`](#private-function-paintrailroad), [private function `clearRailroad()`](#private-function-clearrailroad)

##### private function `paintRailroad(railRoad: RailTile)`

| Parameter  | Type       | Description                 |
| ---------- | ---------- | --------------------------- |
| `railRoad` | `RailTile` | The railroad tile to paint. |

Returns `void`.

Increments occurrence if the tile exists, otherwise adds it to `existingRailroads` and `railTileList`, then paints it using [public function `paintRail()`](#public-function-paintrail).

##### private function `clearRailroad(railRoad: RailTile)`

| Parameter  | Type       | Description                 |
| ---------- | ---------- | --------------------------- |
| `railRoad` | `RailTile` | The railroad tile to clear. |

Returns `void`.

Decrements occurrence of the tile and removes it from `existingRailroads` and `railTileList` if it reaches zero. Clears the tile from `context`, with a larger rectangle for water tiles. Throws an error if the layer is uninitialized.

##### public function `paintRail(railRoad: RailTile)`

| Parameter  | Type       | Description                  |
| ---------- | ---------- | ---------------------------- |
| `railRoad` | `RailTile` | The railroad tile to render. |

Returns `void`.

Paints the railroad tile on `context`. If the tile is over water, paints a bridge first using [private function `paintBridge()`](#private-function-paintbridge). Determines color based on owner; defaults to white if no owner. Uses [private function `paintRailRects()`](#private-function-paintrailrects) to render rail segments. Throws an error if `context` is uninitialized.

##### private function `paintRailRects(context: CanvasRenderingContext2D, x: number, y: number, direction: RailType)`

| Parameter   | Type                       | Description                 |
| ----------- | -------------------------- | --------------------------- |
| `context`   | `CanvasRenderingContext2D` | Context to draw onto.       |
| `x`         | `number`                   | X-coordinate of the tile.   |
| `y`         | `number`                   | Y-coordinate of the tile.   |
| `direction` | `RailType`                 | Type/direction of the rail. |

Returns `void`.

Paints each rectangle segment of a railroad tile as determined by `getRailroadRects(direction)`.

##### private function `paintBridge(context: CanvasRenderingContext2D, x: number, y: number, direction: RailType)`

| Parameter   | Type                       | Description                 |
| ----------- | -------------------------- | --------------------------- |
| `context`   | `CanvasRenderingContext2D` | Context to draw onto.       |
| `x`         | `number`                   | X-coordinate of the tile.   |
| `y`         | `number`                   | Y-coordinate of the tile.   |
| `direction` | `RailType`                 | Type/direction of the rail. |

Returns `void`.

Paints bridge underlay rectangles for water tiles using `getBridgeRects(direction)`. Preserves previous `context` state via `save()`/`restore()`.

### ./layers/RailroadSprites.ts

#### function `getRailroadRects(type: RailType)`

| Parameter | Type       | Description                                                                   |
| --------- | ---------- | ----------------------------------------------------------------------------- |
| `type`    | `RailType` | The type/direction of railroad for which rectangle coordinates are requested. |

Returns `number[][]`.

Returns an array of rectangles `[x, y, w, h]` for the given `RailType`. Throws an error if an unsupported `RailType` is provided.

##### function `horizontalRailroadRects()`

Returns `number[][]`.

Provides rectangle coordinates for a horizontal railroad segment.

##### function `verticalRailroadRects()`

Returns `number[][]`.

Provides rectangle coordinates for a vertical railroad segment.

##### function `topRightRailroadCornerRects()`

Returns `number[][]`.

Provides rectangle coordinates for a top-right railroad corner segment.

##### function `topLeftRailroadCornerRects()`

Returns `number[][]`.

Provides rectangle coordinates for a top-left railroad corner segment.

##### function `bottomRightRailroadCornerRects()`

Returns `number[][]`.

Provides rectangle coordinates for a bottom-right railroad corner segment.

##### function `bottomLeftRailroadCornerRects()`

Returns `number[][]`.

Provides rectangle coordinates for a bottom-left railroad corner segment.

#### function `getBridgeRects(type: RailType)`

| Parameter | Type       | Description                                                               |
| --------- | ---------- | ------------------------------------------------------------------------- |
| `type`    | `RailType` | The type/direction of railroad for which bridge rectangles are requested. |

Returns `number[][]`.

Returns an array of rectangles `[x, y, w, h]` representing bridge underlays for the given `RailType`. Throws an error if an unsupported `RailType` is provided.

##### function `horizontalBridge()`

Returns `number[][]`.

Coordinates for horizontal bridge rectangles.

##### function `verticalBridge()`

Returns `number[][]`.

Coordinates for vertical bridge rectangles.

##### function `topRightBridgeCornerRects()`

Returns `number[][]`.

Coordinates for the top-right corner bridge segment.

##### function `bottomLeftBridgeCornerRects()`

Returns `number[][]`.

Coordinates for the bottom-left corner bridge segment.

##### function `topLeftBridgeCornerRects()`

Returns `number[][]`.

Coordinates for the top-left corner bridge segment.

##### function `bottomRightBridgeCornerRects()`

Returns `number[][]`.

Coordinates for the bottom-right corner bridge segment.

### ./layers/SAMRadiusLayer.ts

#### class `SAMRadiusLayer`

Renders and manages the defense radii of SAM launchers. Implements [interface `Layer`](#interface-layer).

**Properties:**

| Name               | Type                       | Description                                                                |
| ------------------ | -------------------------- | -------------------------------------------------------------------------- |
| `canvas`           | `HTMLCanvasElement`        | Internal off-screen canvas for drawing SAM radii.                          |
| `context`          | `CanvasRenderingContext2D` | 2D drawing context for `canvas`.                                           |
| `samLaunchers`     | `Map<number, number>`      | Tracks active SAM launcher IDs mapped to their owner's `smallID()`.        |
| `needsRedraw`      | `boolean`                  | Indicates whether the layer needs to be redrawn.                           |
| `hoveredShow`      | `boolean`                  | True if the stroke should show due to hover over SAM/Atom/Hydrogen option. |
| `ghostShow`        | `boolean`                  | True if the stroke should show due to an active ghost build.               |
| `showStroke`       | `boolean`                  | Computed stroke visibility based on hover/ghost states.                    |
| `dashOffset`       | `number`                   | Current offset for dashed stroke animation.                                |
| `rotationSpeed`    | `number`                   | Speed of stroke dash animation in pixels per second.                       |
| `lastTickTime`     | `number`                   | Timestamp of the last `tick()` for animation calculations.                 |
| `game`             | `GameView`                 | Reference to the game view.                                                |
| `eventBus`         | `EventBus`                 | Event bus for listening and emitting events.                               |
| `transformHandler` | `TransformHandler`         | Tracks canvas transformations to trigger redraws.                          |
| `uiState`          | `UIState`                  | Current UI state, including ghost structure.                               |

##### public constructor `SAMRadiusLayer(game, eventBus, transformHandler, uiState)`

| Parameter          | Type               | Description                                 |
| ------------------ | ------------------ | ------------------------------------------- |
| `game`             | `GameView`         | The game view to track SAM launchers.       |
| `eventBus`         | `EventBus`         | Event bus for subscribing to toggle events. |
| `transformHandler` | `TransformHandler` | Handles canvas transformations.             |
| `uiState`          | `UIState`          | Tracks ghost structures for display.        |

Returns `SAMRadiusLayer`.

Initializes internal canvas and 2D context. Throws an error if 2D context is unsupported.

##### public function `init()`

Returns `void`.

Registers a listener on `eventBus` for [class `ToggleStructureEvent`](#class-togglestructureevent) and performs an initial `redraw()`.

##### private function `handleToggleStructure(e)`

| Parameter | Type                   | Description                                                     |
| --------- | ---------------------- | --------------------------------------------------------------- |
| `e`       | `ToggleStructureEvent` | Event indicating which structures are being hovered or toggled. |

Returns `void`.

Updates `hoveredShow` if SAMLauncher is included in the event and updates `showStroke` accordingly.

##### private function `updateStrokeVisibility()`

Returns `void`.

Computes `showStroke` from `hoveredShow` and `ghostShow`. Marks `needsRedraw` if visibility changes.

##### public function `shouldTransform()`

Returns `boolean`.

Always returns `true`. Used by [interface `Layer`](#interface-layer) to indicate that canvas transformations should be applied.

##### public function `tick()`

Returns `void`.

Updates tracked SAM launchers based on `game.updatesSinceLastTick()`. Handles ghost structure visibility, updates animation dash offset, and triggers `redraw()` if necessary.

##### public function `renderLayer(context)`

| Parameter | Type                       | Description                                |
| --------- | -------------------------- | ------------------------------------------ |
| `context` | `CanvasRenderingContext2D` | Context of the main canvas to render onto. |

Returns `void`.

Draws the internal off-screen canvas onto the provided context.

##### public function `redraw()`

Returns `void`.

Clears the internal canvas, updates active SAM launchers, computes circle positions and radii, and draws the union of all SAM ranges using [private function `drawCirclesUnion`](#private-function-drawcirclesunion).

##### private function `drawCirclesUnion(circles)`

| Parameter | Type                                                        | Description                                                           |
| --------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `circles` | `Array<{ x: number; y: number; r: number; owner: number }>` | Array of circles representing SAM range positions, radii, and owners. |

Returns `void`.

Fills the union of circles and strokes only the outer arcs to visually combine overlapping SAM ranges. Skips drawing if `showStroke` is false. Uses dashed animated strokes and separates boundaries by owner for clarity.

### ./layers/SendResourcesModal.ts

#### class `SendResourceModal`

Modal for sending resources (troops or gold) to another player.

**Properties:**

| Name              | Type                    | Description                                               |                                                              |
| ----------------- | ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `eventBus`        | `EventBus               | null`                                                     | Event bus for emitting send intent events.                   |
| `open`            | `boolean`               | Whether the modal is open. Defaults to `false`.           |                                                              |
| `mode`            | `'troops'               | 'gold'`                                                   | Type of resource to send. Defaults to `'troops'`.            |
| `total`           | `number                 | bigint`                                                   | Total amount of resource available to send.                  |
| `uiState`         | `UIState                | null`                                                     | Optional UI state to seed initial percent selection.         |
| `format`          | `(n: number) => string` | Function to format numbers. Defaults to `renderTroops()`. |                                                              |
| `myPlayer`        | `PlayerView             | null`                                                     | The sending player.                                          |
| `target`          | `PlayerView             | null`                                                     | The receiving player.                                        |
| `gameView`        | `GameView               | null`                                                     | Reference to the current game view.                          |
| `heading`         | `string                 | null`                                                     | Optional heading text for the modal.                         |
| `sendAmount`      | `number`                | Internal state representing the amount to send.           |                                                              |
| `selectedPercent` | `number                 | null`                                                     | Internal state of currently selected percentage for sending. |

**Constants:**

| Name      | Type                | Description                                           |
| --------- | ------------------- | ----------------------------------------------------- |
| `PRESETS` | `readonly number[]` | Preset percentages for sending (10, 25, 50, 75, 100). |

##### public function `createRenderRoot()`

Returns `this`.

Overrides shadow DOM root to allow Tailwind CSS styling.

##### protected function `connectedCallback()`

Returns `void`.

Initializes `selectedPercent` and computes `sendAmount` based on `uiState` and total resource.

##### protected function `updated(changed)`

| Parameter | Type                   | Description                |
| --------- | ---------------------- | -------------------------- |
| `changed` | `Map<string, unknown>` | Map of changed properties. |

Returns `void`.

Updates `sendAmount` when relevant properties (`total`, `mode`, `target`, `gameView`) change. Handles auto-closing if sender or target is dead.

##### private function `closeModal()`

Returns `void`.

Dispatches a `close` custom event to close the modal.

##### private function `confirm()`

Returns `void`.

Validates sender and target are alive and `eventBus` is available. Emits [class `SendDonateTroopsIntentEvent`](#class-senddonatetroopsintentevent) or [class `SendDonateGoldIntentEvent`](#class-senddonategoldintentevent) depending on mode. Closes the modal on success.

##### private function `handleKeydown(e)`

| Parameter | Type            | Description     |
| --------- | --------------- | --------------- |
| `e`       | `KeyboardEvent` | Keyboard event. |

Returns `void`.

Handles Escape to close modal and Enter to confirm send.

##### private function `toNum(x)`

| Parameter | Type      | Description                 |
| --------- | --------- | --------------------------- |
| `x`       | `unknown` | Value to convert to number. |

Returns `number`.

Converts `bigint` or other numeric-like values to `number`.

##### private function `getTotalNumber()`

Returns `number`.

Returns total available resource if sender is alive, otherwise 0.

##### private function `sanitizePercent(p)`

| Parameter | Type     | Description                |
| --------- | -------- | -------------------------- |
| `p`       | `number` | Percent value to sanitize. |

Returns `number`.

Clamps percent between 0 and 100.

##### private function `getCapacityLeft()`

Returns `number | null`.

Computes remaining capacity for troops. Returns `null` for gold or if target/gameView is missing.

##### private function `getPercentBasis()`

Returns `number`.

Returns the total number available to send.

##### private function `limitAmount(proposed)`

| Parameter  | Type     | Description           |
| ---------- | -------- | --------------------- |
| `proposed` | `number` | Proposed send amount. |

Returns `number`.

Limits the proposed amount to total available and capacity constraints.

##### private function `clampSend(n)`

| Parameter | Type     | Description      |
| --------- | -------- | ---------------- |
| `n`       | `number` | Amount to clamp. |

Returns `number`.

Clamps send amount based on total and capacity.

##### private function `percentOfBasis(n)`

| Parameter | Type     | Description                         |
| --------- | -------- | ----------------------------------- |
| `n`       | `number` | Amount to compute percent of basis. |

Returns `number`.

Computes percentage of basis.

##### private function `keepAfter(allowed)`

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `allowed` | `number` | Amount allowed to send. |

Returns `number`.

Computes the remaining resource after sending `allowed`.

##### private function `getFillColor()`

Returns `string`.

Returns purple for troops, amber for gold.

##### private function `getMinKeepRatio()`

Returns `number`.

Minimum ratio to keep for troops (0.3) or gold (0).

##### private function `isTargetAlive()`

Returns `boolean`.

Checks if the target player is alive.

##### private function `isSenderAlive()`

Returns `boolean`.

Checks if the sending player is alive.

##### private function `renderHeader()`

Returns `import('lit').TemplateResult`.

Renders modal header with optional `heading` and close button.

##### private function `renderAvailable()`

Returns `import('lit').TemplateResult`.

Displays total available resource.

##### private function `renderPresets(percentNow)`

| Parameter    | Type     | Description                |
| ------------ | -------- | -------------------------- |
| `percentNow` | `number` | Current percent selection. |

Returns `import('lit').TemplateResult`.

Renders preset percentage buttons.

##### private function `renderSlider(percentNow)`

| Parameter    | Type     | Description                |
| ------------ | -------- | -------------------------- |
| `percentNow` | `number` | Current percent selection. |

Returns `import('lit').TemplateResult`.

Renders slider input for selecting send amount, including optional capacity marker.

##### private function `renderCapacityNote(allowed)`

| Parameter | Type     | Description          |
| --------- | -------- | -------------------- |
| `allowed` | `number` | Allowed send amount. |

Returns `import('lit').TemplateResult`.

Displays note when send amount is capped by target capacity.

##### private function `renderSummary(allowed)`

| Parameter | Type     | Description          |
| --------- | -------- | -------------------- |
| `allowed` | `number` | Allowed send amount. |

Returns `import('lit').TemplateResult`.

Displays summary of send and remaining resources.

##### private function `renderActions()`

Returns `import('lit').TemplateResult`.

Renders Cancel and Send buttons, disables if sending is not allowed.

##### private function `renderDeadNote()`

Returns `import('lit').TemplateResult`.

Displays message when target player is dead.

##### private function `renderSliderStyles()`

Returns `import('lit').TemplateResult`.

Provides inline CSS styles for slider input.

##### public function `render()`

Returns `import('lit').TemplateResult | undefined`.

Renders the entire modal if `open` is true, including header, available resource, presets, slider, capacity note, summary, actions, and slider styles.

### ./layers/SettingsModal.ts

#### class `ShowSettingsModalEvent`

Represents an event to toggle the visibility of the settings modal.

##### public constructor `ShowSettingsModalEvent(isVisible?, shouldPause?, isPaused?)`

| Parameter      | Type      | Description                                                                                  |
| -------------- | --------- | -------------------------------------------------------------------------------------------- |
| `isVisible?`   | `boolean` | Optional. Indicates whether the modal should be visible. Defaults to `true`.                 |
| `shouldPause?` | `boolean` | Optional. Indicates if the game should pause when the modal opens. Defaults to `false`.      |
| `isPaused?`    | `boolean` | Optional. Indicates if the game is already paused when the modal opens. Defaults to `false`. |

#### class `SettingsModal`

Displays and manages the settings modal. Implements [interface `Layer`](#interface-layer).

**Properties:**

| Name                  | Type           | Description                                                                   |
| --------------------- | -------------- | ----------------------------------------------------------------------------- |
| `eventBus`            | `EventBus`     | Event bus for subscribing and emitting events.                                |
| `userSettings`        | `UserSettings` | Reference to the current user settings.                                       |
| `isVisible`           | `boolean`      | Internal state tracking whether the modal is visible. Defaults to `false`.    |
| `alternateView`       | `boolean`      | Tracks whether the alternate terrain view is enabled. Defaults to `false`.    |
| `modalOverlay`        | `HTMLElement`  | Reference to the modal overlay element.                                       |
| `shouldPause`         | `boolean`      | Indicates if the game should pause when the modal opens. Defaults to `false`. |
| `wasPausedWhenOpened` | `boolean`      | Tracks if the game was paused when the modal opened. Defaults to `false`.     |

##### public function `init()`

Returns `void`.

Initializes volume settings via `SoundManager` and subscribes to [class `ShowSettingsModalEvent`](#class-showsettingsmodalevent) to open the modal and optionally pause the game.

##### public function `createRenderRoot()`

Returns `this`.

Overrides the default shadow DOM root to allow styling.

##### public function `connectedCallback()`

Returns `void`.

Adds global event listeners for click and keydown events to detect outside clicks and escape key presses.

##### public function `disconnectedCallback()`

Returns `void`.

Removes previously added global event listeners.

##### private function `handleOutsideClick(event)`

| Parameter | Type         | Description                                             |
| --------- | ------------ | ------------------------------------------------------- |
| `event`   | `MouseEvent` | Click event to detect if it occurred outside the modal. |

Returns `void`.

Closes the modal if an outside click is detected.

##### private function `handleKeyDown(event)`

| Parameter | Type            | Description                         |
| --------- | --------------- | ----------------------------------- |
| `event`   | `KeyboardEvent` | Keydown event to detect Escape key. |

Returns `void`.

Closes the modal if Escape is pressed.

##### public function `openModal()`

Returns `void`.

Sets `isVisible` to true, prevents body scrolling, and requests an update.

##### public function `closeModal()`

Returns `void`.

Sets `isVisible` to false, restores body scrolling, requests an update, and calls `pauseGame(false)`.

##### private function `pauseGame(pause)`

| Parameter | Type      | Description                                     |
| --------- | --------- | ----------------------------------------------- |
| `pause`   | `boolean` | Indicates whether to pause or unpause the game. |

Returns `void`.

Pauses the game if `shouldPause` is true and the game was not already paused when opened.

##### private function `onTerrainButtonClick()`

Returns `void`.

Toggles the alternate terrain view and emits [class `AlternateViewEvent`](#class-alternateviewevent).

##### private function `onToggleEmojisButtonClick()`

Returns `void`.

Toggles emoji display in `userSettings`.

##### private function `onToggleStructureSpritesButtonClick()`

Returns `void`.

Toggles structure sprite display in `userSettings`.

##### private function `onToggleSpecialEffectsButtonClick()`

Returns `void`.

Toggles special effects display in `userSettings`.

##### private function `onToggleDarkModeButtonClick()`

Returns `void`.

Toggles dark mode in `userSettings` and emits [class `RefreshGraphicsEvent`](#class-refreshgraphicsevent).

##### private function `onToggleRandomNameModeButtonClick()`

Returns `void`.

Toggles anonymous/random name display in `userSettings`.

##### private function `onToggleLeftClickOpensMenu()`

Returns `void`.

Toggles left-click opens menu behavior in `userSettings`.

##### private function `onTogglePerformanceOverlayButtonClick()`

Returns `void`.

Toggles performance overlay display in `userSettings`.

##### private function `onExitButtonClick()`

Returns `void`.

Redirects the page to the home URL (`/`).

##### private function `onVolumeChange(event)`

| Parameter | Type    | Description                                      |
| --------- | ------- | ------------------------------------------------ |
| `event`   | `Event` | Input event from background music volume slider. |

Returns `void`.

Updates background music volume in `userSettings` and via `SoundManager`.

##### private function `onSoundEffectsVolumeChange(event)`

| Parameter | Type    | Description                                   |
| --------- | ------- | --------------------------------------------- |
| `event`   | `Event` | Input event from sound effects volume slider. |

Returns `void`.

Updates sound effects volume in `userSettings` and via `SoundManager`.

##### public function `render()`

Returns `import('lit').TemplateResult | null`.

Renders the modal when `isVisible` is true, including controls for volume, dark mode, terrain, emoji toggles, structure sprites, special effects, random names, left-click menu behavior, performance overlay, and exit button.

### ./layers/SpawnTimer.ts

#### class `SpawnTimer`

Displays a progress bar representing the spawn phase and team tile ratios. Implements [interface `Layer`](#interface-layer).

**Properties:**

| Name               | Type               | Description                                                         |
| ------------------ | ------------------ | ------------------------------------------------------------------- |
| `game`             | `GameView`         | Reference to the current game view.                                 |
| `transformHandler` | `TransformHandler` | Tracks canvas transformations, unused for this layer.               |
| `ratios`           | `number[]`         | Array of width ratios for each segment of the progress bar.         |
| `colors`           | `string[]`         | Array of colors corresponding to each ratio segment.                |
| `isVisible`        | `boolean`          | Determines whether the spawn timer is visible. Defaults to `false`. |

##### public function `createRenderRoot()`

Returns `this`.

Sets fixed position styling for the progress bar and disables pointer events.

##### public function `init()`

Returns `void`.

Initializes `isVisible` to true.

##### public function `tick()`

Returns `void`.

Updates `ratios` and `colors` based on the game state:

- If the game is in the spawn phase, shows a single segment filling proportionally to elapsed turns.
- If the game mode is `Team`, calculates segment ratios based on team-owned tiles and applies team colors from the theme.
- Requests update via `requestUpdate()`.

##### public function `shouldTransform()`

Returns `boolean`.

Always returns `false` since the layer does not require canvas transformations.

##### public function `render()`

Returns `import('lit').TemplateResult`.

Renders a horizontal bar composed of colored divs corresponding to `ratios` and `colors`. Returns empty content if the layer is invisible or there is no data to render.

#### private function `sumIterator(values)`

| Parameter | Type                  | Description                          |
| --------- | --------------------- | ------------------------------------ |
| `values`  | `MapIterator<number>` | Iterator over numeric values to sum. |

Returns `number`.

Computes the sum of all values in the provided iterator.

### ./layers/StructureDrawingUtils.ts

#### Constants

**`STRUCTURE_SHAPES`** `Partial<Record<UnitType, ShapeType>>`
Maps `UnitType` values to corresponding shape strings used for rendering.

**`LEVEL_SCALE_FACTOR`** `number` — Factor used to scale level indicators.

**`ICON_SCALE_FACTOR_ZOOMED_IN`** `number` — Scaling factor for icons when zoomed in.

**`ICON_SCALE_FACTOR_ZOOMED_OUT`** `number` — Scaling factor for icons when zoomed out.

**`DOTS_ZOOM_THRESHOLD`** `number` — Zoom threshold for rendering dots.

**`ZOOM_THRESHOLD`** `number` — Zoom threshold for rendering icons or levels.

**`ICON_SIZE`** `{ [shape in ShapeType]: number }` — Default icon size per shape.

**`OFFSET_ZOOM_Y`** `number` — Vertical offset applied when zooming.

#### Type `ShapeType`

Represents valid shape identifiers for structures.

- `triangle` | `square` | `pentagon` | `octagon` | `circle` | `cross`

#### class `SpriteFactory`

Responsible for generating PIXI sprites for structures, including icons, level indicators, ghost containers, and range graphics.

**Properties:**

| Name               | Type                                                       | Description                                                       |                                                               |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `theme`            | `Theme`                                                    | The theme used for coloring sprites.                              |                                                               |
| `game`             | `GameView`                                                 | Reference to the game view for coordinate and configuration data. |                                                               |
| `transformHandler` | `TransformHandler`                                         | Handles conversion between world and screen coordinates.          |                                                               |
| `renderSprites`    | `boolean`                                                  | Flag indicating whether full sprite rendering is enabled.         |                                                               |
| `textureCache`     | `Map<string, PIXI.Texture>`                                | Caches generated textures keyed by type and state.                |                                                               |
| `structuresInfos`  | `Map<UnitType, { iconPath: string; image: HTMLImageElement | null }>`                                                          | Stores image paths and loaded images for each structure type. |

##### constructor `SpriteFactory()`

| Parameter          | Type               | Description                         |
| ------------------ | ------------------ | ----------------------------------- |
| `theme`            | `Theme`            | Theme for coloring sprites.         |
| `game`             | `GameView`         | Game view reference.                |
| `transformHandler` | `TransformHandler` | Handles coordinate transformations. |
| `renderSprites`    | `boolean`          | Whether to render sprites fully.    |

Initializes structure icons by loading their images.

##### private function `loadIcon()`

| Parameter  | Type                                         | Description        |                             |
| ---------- | -------------------------------------------- | ------------------ | --------------------------- |
| `unitInfo` | `{ iconPath: string; image: HTMLImageElement | null }`            | Structure icon information. |
| `unitType` | `UnitType`                                   | Type of structure. |                             |

Returns `void`.

Loads the icon image and sets it on `unitInfo.image`. Logs errors on load failure.

##### private function `invalidateTextureCache()`

| Parameter  | Type       | Description                                                 |
| ---------- | ---------- | ----------------------------------------------------------- |
| `unitType` | `UnitType` | Structure type whose cached textures should be invalidated. |

Returns `void`.

Removes cached textures for the specified structure type.

##### public function `createGhostContainer()`

| Parameter       | Type                       | Description                                  |
| --------------- | -------------------------- | -------------------------------------------- |
| `player`        | `PlayerView`               | Player owning the structure.                 |
| `ghostStage`    | `PIXI.Container`           | Stage to which the ghost container is added. |
| `pos`           | `{ x: number; y: number }` | Position to place the container.             |
| `structureType` | `UnitType`                 | Type of structure.                           |

Returns `PIXI.Container`.

Creates a semi-transparent container representing a ghost structure at the specified position.

##### public function `createUnitContainer()`

| Parameter | Type             | Description         |                                   |                                                                       |
| --------- | ---------------- | ------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `unit`    | `UnitView`       | The unit to render. |                                   |                                                                       |
| `options` | `{ type?: "icon" | "dot"               | "level"; stage: PIXI.Container }` | Rendering options; `type` is optional and defaults to icon rendering. |

Returns `PIXI.Container`.

Creates a container for the unit with the appropriate sprite, level indicator, or dot representation. Adds container to the specified stage.

##### private function `createTexture()`

| Parameter             | Type         | Description                                   |
| --------------------- | ------------ | --------------------------------------------- |
| `type`                | `UnitType`   | Structure type.                               |
| `owner`               | `PlayerView` | Player owning the structure.                  |
| `isConstruction`      | `boolean`    | Whether the structure is under construction.  |
| `isMarkedForDeletion` | `boolean`    | Whether the structure is marked for deletion. |
| `renderIcon`          | `boolean`    | Whether to render the full icon.              |

Returns `PIXI.Texture`.

Generates or retrieves a cached texture for a structure. Uses `createIcon()` when shape is defined.

##### private function `createIcon()`

| Parameter             | Type         | Description                                   |
| --------------------- | ------------ | --------------------------------------------- |
| `owner`               | `PlayerView` | Player owning the structure.                  |
| `structureType`       | `UnitType`   | Type of structure.                            |
| `isConstruction`      | `boolean`    | Whether the structure is under construction.  |
| `isMarkedForDeletion` | `boolean`    | Whether the structure is marked for deletion. |
| `shape`               | `string`     | Shape to render.                              |
| `renderIcon`          | `boolean`    | Whether to render the full icon.              |

Returns `PIXI.Texture`.

Draws the structure icon onto a canvas, including optional construction colors, borders, deletion marks, and the base image if present. Throws on unknown shapes.

##### public function `createRange()`

| Parameter | Type                       | Description                                  |
| --------- | -------------------------- | -------------------------------------------- |
| `type`    | `UnitType`                 | Structure type whose range is drawn.         |
| `stage`   | `PIXI.Container`           | Stage to which the range container is added. |
| `pos`     | `{ x: number; y: number }` | Position to place the range circle.          |

Returns `PIXI.Container | null`. Returns `null` if type does not have a defined range.

Creates a semi-transparent range indicator for structures with applicable ranges.

##### private function `getImageColored()`

| Parameter | Type               | Description             |
| --------- | ------------------ | ----------------------- |
| `image`   | `HTMLImageElement` | Base image to colorize. |
| `color`   | `string`           | Color to apply.         |

Returns `HTMLCanvasElement`.

Applies the specified color to the given image using a temporary canvas and returns the result.

### ./layers/StructureIconsLayer.ts

#### class `StructureRenderInfo`

Holds rendering information for a single unit's structure icon, level, and dot representations.

**Properties:**

| Name                | Type             | Description                                                                |
| ------------------- | ---------------- | -------------------------------------------------------------------------- |
| `unit`              | `UnitView`       | The unit this render info represents.                                      |
| `owner`             | `PlayerID`       | ID of the player owning the unit.                                          |
| `iconContainer`     | `PIXI.Container` | Container for the unit's icon sprite.                                      |
| `levelContainer`    | `PIXI.Container` | Container for the unit's level sprite.                                     |
| `dotContainer`      | `PIXI.Container` | Container for the unit's dot representation.                               |
| `level`             | `number`         | Current level of the unit. Defaults to 0.                                  |
| `underConstruction` | `boolean`        | Whether the unit is under construction. Defaults to `true`.                |
| `isOnScreen`        | `boolean`        | Indicates if the unit is currently visible on screen. Defaults to `false`. |

#### class `StructureIconsLayer`

Manages rendering, updating, and interaction for structure icons, levels, and dots on the game map.

**Properties:**

| Name               | Type                                                | Description                                              |                                                         |                                                                   |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `ghostUnit`        | `{ container: PIXI.Container; range: PIXI.Container | null; buildableUnit: BuildableUnit; }                    | null`                                                   | Currently active ghost structure being placed, or `null` if none. |
| `pixicanvas`       | `HTMLCanvasElement`                                 | Canvas used for rendering PIXI stages.                   |                                                         |                                                                   |
| `iconsStage`       | `PIXI.Container`                                    | Stage containing icon sprites.                           |                                                         |                                                                   |
| `ghostStage`       | `PIXI.Container`                                    | Stage containing ghost sprites.                          |                                                         |                                                                   |
| `levelsStage`      | `PIXI.Container`                                    | Stage containing level sprites.                          |                                                         |                                                                   |
| `dotsStage`        | `PIXI.Container`                                    | Stage containing dot sprites.                            |                                                         |                                                                   |
| `rootStage`        | `PIXI.Container`                                    | Root container holding all stages.                       |                                                         |                                                                   |
| `playerActions`    | `PlayerActions                                      | null`                                                    | Actions available to the current player.                |                                                                   |
| `theme`            | `Theme`                                             | Current game theme.                                      |                                                         |                                                                   |
| `renderer`         | `PIXI.Renderer`                                     | Renderer for drawing the PIXI canvas.                    |                                                         |                                                                   |
| `renders`          | `StructureRenderInfo[]`                             | Active rendered structures.                              |                                                         |                                                                   |
| `seenUnits`        | `Set<UnitView>`                                     | Units that have been seen and rendered.                  |                                                         |                                                                   |
| `mousePos`         | `{ x: number; y: number }`                          | Current mouse position in pixels.                        |                                                         |                                                                   |
| `renderSprites`    | `boolean`                                           | Flag indicating if structure sprites should be rendered. |                                                         |                                                                   |
| `factory`          | `SpriteFactory`                                     | Factory for creating PIXI sprites.                       |                                                         |                                                                   |
| `structures`       | `Map<UnitType, { visible: boolean }>`               | Visibility settings per unit type.                       |                                                         |                                                                   |
| `lastGhostQueryAt` | `number`                                            | Timestamp of last ghost update.                          |                                                         |                                                                   |
| `potentialUpgrade` | `StructureRenderInfo                                | undefined`                                               | Stores the render info of a potential upgradeable unit. |                                                                   |

##### public constructor `StructureIconsLayer()`

| Parameter          | Type               | Description                                     |
| ------------------ | ------------------ | ----------------------------------------------- |
| `game`             | `GameView`         | Reference to the main game view.                |
| `eventBus`         | `EventBus`         | Event bus for handling game and input events.   |
| `uiState`          | `UIState`          | Current UI state for the game.                  |
| `transformHandler` | `TransformHandler` | Handles coordinate transformations and scaling. |

Initializes internal structures, sprite factory, and theme.

##### public function `setupRenderer()`

Returns `Promise<void>`.

Initializes the PIXI renderer and sets up stages for icons, levels, dots, and ghosts. Loads bitmap fonts required for sprite rendering.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates whether this layer should be affected by map transformations. Always returns `false`.

##### public function `init()`

Returns `Promise<void>`.

Sets up event listeners for mouse and toggle events, window resize, initializes the renderer, and triggers an initial redraw.

##### public function `resizeCanvas()`

Returns `void`.

Updates canvas dimensions and resizes the PIXI renderer to match the current window size.

##### public function `tick()`

Returns `void`.

Updates rendered structures based on the latest game unit updates and user settings.

##### public function `redraw()`

Returns `void`.

Resizes the canvas and prepares for rendering the next frame.

##### public function `renderLayer()`

| Parameter     | Type                       | Description                                  |
| ------------- | -------------------------- | -------------------------------------------- |
| `mainContext` | `CanvasRenderingContext2D` | The 2D rendering context of the main canvas. |

Returns `void`.

Renders all visible structures, levels, and dots. Updates ghost structures and positions based on transformations and zoom level.

##### public function `renderGhost()`

Returns `void`.

Updates and renders the ghost structure at the current mouse position. Handles build and upgrade availability, visual filters, and scaling. Applies a 50ms throttling for performance.

##### private function `createStructure()`

| Parameter | Type           | Description                                        |
| --------- | -------------- | -------------------------------------------------- |
| `e`       | `MouseUpEvent` | Mouse event used to determine structure placement. |

Returns `void`.

Finalizes placement or upgrade of a ghost structure and emits the corresponding build or upgrade event. Removes the ghost structure after action.

##### private function `moveGhost()`

| Parameter | Type             | Description                           |
| --------- | ---------------- | ------------------------------------- |
| `e`       | `MouseMoveEvent` | Mouse event with updated coordinates. |

Returns `void`.

Updates the position of the ghost structure based on mouse movement.

##### private function `createGhostStructure()`

| Parameter | Type      | Description |                                                |
| --------- | --------- | ----------- | ---------------------------------------------- |
| `type`    | `UnitType | null`       | Type of unit to create a ghost for, or `null`. |

Returns `void`.

Creates a ghost structure container, range overlay, and placeholder `BuildableUnit` for visual placement feedback.

##### private function `clearGhostStructure()`

Returns `void`.

Destroys the current ghost structure and clears any potential upgrade highlighting.

##### private function `removeGhostStructure()`

Returns `void`.

Calls `clearGhostStructure()` and resets the `uiState.ghostStructure` to `null`.

##### private function `toggleStructures()`

| Parameter             | Type        | Description |                                                                |
| --------------------- | ----------- | ----------- | -------------------------------------------------------------- |
| `toggleStructureType` | `UnitType[] | null`       | Array of structure types to show; `null` shows all structures. |

Returns `void`.

Updates visibility of structure types and triggers modifications for all rendered units.

##### private function `findRenderByUnit()`

| Parameter  | Type       | Description                                     |
| ---------- | ---------- | ----------------------------------------------- |
| `unitView` | `UnitView` | Unit to find the corresponding render info for. |

Returns `StructureRenderInfo | undefined`.

Searches the active renders array for the render info corresponding to the given unit.

##### private function `handleActiveUnit()`

| Parameter  | Type       | Description           |
| ---------- | ---------- | --------------------- |
| `unitView` | `UnitView` | Unit being processed. |

Returns `void`.

Updates or creates rendering for active units, checking for construction, deletion, ownership, and level changes.

##### private function `handleInactiveUnit()`

| Parameter  | Type       | Description           |
| ---------- | ---------- | --------------------- |
| `unitView` | `UnitView` | Unit being processed. |

Returns `void`.

Deletes structure rendering for units no longer active.

##### private function `modifyVisibility()`

| Parameter | Type                  | Description                                            |
| --------- | --------------------- | ------------------------------------------------------ |
| `render`  | `StructureRenderInfo` | Render info of the structure to update visibility for. |

Returns `void`.

Adjusts alpha and outline filters based on the visibility of the structure type.

##### private function `checkForDeletionState()`

| Parameters | Type                  | Description                      |
| ---------- | --------------------- | -------------------------------- |
| `render`   | `StructureRenderInfo` | Render info of the structure.    |
| `unit`     | `UnitView`            | Unit being checked for deletion. |

Returns `void`.

Recreates the icon and dot sprites if the unit is marked for deletion.

##### private function `checkForConstructionState()`

| Parameters | Type                  | Description                   |
| ---------- | --------------------- | ----------------------------- |
| `render`   | `StructureRenderInfo` | Render info of the structure. |
| `unit`     | `UnitView`            | Unit being checked.           |

Returns `void`.

Updates sprite containers if a unit has finished construction.

##### private function `checkForOwnershipChange()`

| Parameters | Type                  | Description                   |
| ---------- | --------------------- | ----------------------------- |
| `render`   | `StructureRenderInfo` | Render info of the structure. |
| `unit`     | `UnitView`            | Unit being checked.           |

Returns `void`.

Updates sprite containers if the unit ownership has changed.

##### private function `checkForLevelChange()`

| Parameters | Type                  | Description                   |
| ---------- | --------------------- | ----------------------------- |
| `render`   | `StructureRenderInfo` | Render info of the structure. |
| `unit`     | `UnitView`            | Unit being checked.           |

Returns `void`.

Updates level sprite container if the unit's level has changed.

##### private function `computeNewLocation()`

| Parameter | Type                  | Description                   |
| --------- | --------------------- | ----------------------------- |
| `render`  | `StructureRenderInfo` | Render info of the structure. |

Returns `void`.

Calculates on-screen position for icon, level, and dot containers based on world coordinates, scaling, and zoom thresholds.

##### private function `addNewStructure()`

| Parameter  | Type       | Description                |
| ---------- | ---------- | -------------------------- |
| `unitView` | `UnitView` | Unit to add rendering for. |

Returns `void`.

Creates new render info for a unit, adds it to active renders, computes its location, and applies visibility rules.

##### private function `createLevelSprite()`

| Parameter | Type       | Description                        |
| --------- | ---------- | ---------------------------------- |
| `unit`    | `UnitView` | Unit to create a level sprite for. |

Returns `PIXI.Container`.

Uses `SpriteFactory` to create the level representation for a unit.

##### private function `createDotSprite()`

| Parameter | Type       | Description                      |
| --------- | ---------- | -------------------------------- |
| `unit`    | `UnitView` | Unit to create a dot sprite for. |

Returns `PIXI.Container`.

Uses `SpriteFactory` to create the dot representation for a unit.

##### private function `createIconSprite()`

| Parameter | Type       | Description                        |
| --------- | ---------- | ---------------------------------- |
| `unit`    | `UnitView` | Unit to create an icon sprite for. |

Returns `PIXI.Container`.

Uses `SpriteFactory` to create the icon representation for a unit.

##### private function `deleteStructure()`

| Parameter | Type                  | Description                             |
| --------- | --------------------- | --------------------------------------- |
| `render`  | `StructureRenderInfo` | Render info of the structure to delete. |

Returns `void`.

Destroys all sprite containers and removes the structure from the active renders and seen units.

### ./layers/StructureLayers.ts

#### class `StructureLayer`

Renders unit structures, borders, and territories on a dedicated canvas layer. Handles icon loading, scaling, and updates based on game events.

**Properties:**

| Name          | Type                                          | Description                                                                                      |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `canvas`      | `HTMLCanvasElement`                           | Main canvas used for rendering the structure layer.                                              |
| `context`     | `CanvasRenderingContext2D`                    | Rendering context for the main canvas.                                                           |
| `unitIcons`   | `Map<string, HTMLImageElement>`               | Maps unit types to loaded icon images.                                                           |
| `theme`       | `Theme`                                       | Current theme configuration.                                                                     |
| `tempCanvas`  | `HTMLCanvasElement`                           | Temporary canvas for high-quality icon rendering.                                                |
| `tempContext` | `CanvasRenderingContext2D`                    | Rendering context for `tempCanvas`.                                                              |
| `unitConfigs` | `Partial<Record<UnitType, UnitRenderConfig>>` | Configuration for supported unit types, including icon paths, border radii, and territory radii. |

##### public constructor `StructureLayer()`

| Parameter          | Type               | Description                                            |
| ------------------ | ------------------ | ------------------------------------------------------ |
| `game`             | `GameView`         | Game view providing units, updates, and configuration. |
| `eventBus`         | `EventBus`         | Event bus for game events.                             |
| `transformHandler` | `TransformHandler` | Handler for coordinate transformations.                |

Initializes the structure layer, loads unit icons, and sets up temporary rendering resources.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates that this layer requires coordinate transformations for rendering.

##### public function `tick()`

Returns `void`.

Processes game updates since the last tick, updating unit rendering as necessary.

##### public function `init()`

Returns `void`.

Initializes and redraws the structure layer.

##### public function `redraw()`

Returns `void`.

Creates a new canvas, sets scaling options, decodes loaded unit icons, and renders all units.

##### public function `renderLayer()`

| Parameter | Type                       | Description                                |
| --------- | -------------------------- | ------------------------------------------ |
| `context` | `CanvasRenderingContext2D` | Rendering context to draw this layer onto. |

Returns `void`.

Draws the structure layer onto the provided context if the zoom level and user settings allow it.

##### private function `loadIcon()`

| Parameter  | Type               | Description                                   |
| ---------- | ------------------ | --------------------------------------------- |
| `unitType` | `string`           | The type of unit to load the icon for.        |
| `config`   | `UnitRenderConfig` | Configuration containing icon path and radii. |

Returns `void`.

Loads a unit icon image and stores it in `unitIcons`. Logs success or failure.

##### private function `loadIconData()`

Returns `void`.

Loads all configured unit icons using `loadIcon()`.

##### private function `isUnitTypeSupported()`

| Parameter  | Type       | Description                     |
| ---------- | ---------- | ------------------------------- |
| `unitType` | `UnitType` | Unit type to check support for. |

Returns `boolean`. Returns `true` if the unit type exists in `unitConfigs`.

##### private function `handleUnitRendering()`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | Unit instance to render. |

Returns `void`. Handles clearing, border drawing, and icon rendering for a single unit. Skips unsupported types or inactive units.

See also: [private function `drawBorder()`](#private-function-drawborder), [private function `renderIcon()`](#private-function-rendericon)

##### private function `drawBorder()`

| Parameter     | Type               | Description                           |
| ------------- | ------------------ | ------------------------------------- |
| `unit`        | `UnitView`         | Unit to draw borders for.             |
| `borderColor` | `Colord`           | Color to use for the border.          |
| `config`      | `UnitRenderConfig` | Rendering configuration for the unit. |

Returns `void`. Draws the unit's border and territory cells on the canvas using the provided colors.

##### private function `renderIcon()`

| Parameter | Type               | Description                          |
| --------- | ------------------ | ------------------------------------ |
| `image`   | `HTMLImageElement` | Icon image to render.                |
| `startX`  | `number`           | X-coordinate for the icon placement. |
| `startY`  | `number`           | Y-coordinate for the icon placement. |
| `width`   | `number`           | Width to render the icon.            |
| `height`  | `number`           | Height to render the icon.           |
| `unit`    | `UnitView`         | Unit associated with the icon.       |

Returns `void`. Draws the icon onto the main canvas using the temporary high-resolution canvas. Handles scaling and alpha channel.

##### public function `paintCell()`

| Parameter | Type     | Description                       |
| --------- | -------- | --------------------------------- |
| `cell`    | `Cell`   | Cell to paint.                    |
| `color`   | `Colord` | Color to paint the cell.          |
| `alpha`   | `number` | Alpha value (0–255) for the cell. |

Returns `void`. Clears the cell and fills it with the specified color and transparency.

##### public function `clearCell()`

| Parameter | Type   | Description    |
| --------- | ------ | -------------- |
| `cell`    | `Cell` | Cell to clear. |

Returns `void`. Clears the cell area on the main canvas.

### ./layers/TeamStats.ts

#### class `TeamStats`

Displays team statistics in a grid view, including scores, resources, and unit counts. Updates periodically based on game ticks and supports toggling between different unit views.

**Properties:**

| Name           | Type          | Description                                                                         |
| -------------- | ------------- | ----------------------------------------------------------------------------------- |
| `game`         | `GameView`    | The game view providing players, teams, and game state.                             |
| `eventBus`     | `EventBus`    | Event bus for subscribing to game events.                                           |
| `visible`      | `boolean`     | Indicates if the team stats layer is visible. Defaults to `false`.                  |
| `teams`        | `TeamEntry[]` | Array of aggregated team statistics.                                                |
| `_shownOnInit` | `boolean`     | Internal flag to track initial display state.                                       |
| `showUnits`    | `boolean`     | Determines whether to show unit breakdowns (`true`) or score/gold/troops (`false`). |

##### public constructor

Uses default LitElement constructor. No custom parameters.

##### public function `createRenderRoot()`

Returns `this`.

Uses the light DOM to allow Tailwind styling.

##### public function `init()`

Returns `void`.

Placeholder for interface compliance; no initialization required.

##### public function `tick()`

Returns `void`.

Updates team statistics based on game mode and ticks. Only updates when in `Team` game mode and visible. Refreshes every 10 ticks or once on initial display.

See also: [private function `updateTeamStats()`](#private-function-updateteamstats)

##### private function `updateTeamStats()`

Returns `void`.

Aggregates statistics for all teams, including total score, gold, troops, cities, launchers, SAMs, and warships. Updates `teams` property and triggers re-render.

##### public function `renderLayer()`

| Parameter | Type                       | Description                     |
| --------- | -------------------------- | ------------------------------- |
| `context` | `CanvasRenderingContext2D` | Context to render the layer on. |

Returns `void`. Empty implementation for interface compliance.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates that this layer does not require coordinate transformations.

##### public function `render()`

Returns `TemplateResult`.

Renders the team stats as an HTML grid. Supports toggling between resource view and unit view via a button. Uses translation utilities for headers and Tailwind CSS for styling.

#### interface `TeamEntry`

Aggregates team statistics for display.

**Properties:**

| Name             | Type           | Description                             |
| ---------------- | -------------- | --------------------------------------- |
| `teamName`       | `string`       | Name of the team.                       |
| `totalScoreStr`  | `string`       | Formatted score percentage string.      |
| `totalGold`      | `string`       | Formatted total gold for the team.      |
| `totalTroops`    | `string`       | Formatted total troop count.            |
| `totalSAMs`      | `string`       | Formatted total SAM launchers.          |
| `totalLaunchers` | `string`       | Formatted total missile silos.          |
| `totalWarShips`  | `string`       | Formatted total warships.               |
| `totalCities`    | `string`       | Formatted total cities.                 |
| `totalScoreSort` | `number`       | Numeric score used for sorting teams.   |
| `players`        | `PlayerView[]` | Array of players belonging to the team. |

##### private function `formatPercentage()`

| Parameter | Type     | Description                                     |
| --------- | -------- | ----------------------------------------------- |
| `value`   | `number` | Score fraction (0–1) to format as a percentage. |

Returns `string`. Converts a numeric fraction to a percentage string with precision, returning "0%" if NaN and "100%" for exact full score.

### ./layers/TerrainLayer.ts

#### class `TerrainLayer`

Implements the `Layer` interface to manage the terrain rendering layer for a game view. Handles canvas creation, image data initialization, and layer rendering.

**Properties:**

| Name               | Type                       | Description                                |
| ------------------ | -------------------------- | ------------------------------------------ |
| `canvas`           | `HTMLCanvasElement`        | Canvas element where terrain is drawn.     |
| `context`          | `CanvasRenderingContext2D` | 2D rendering context for the canvas.       |
| `imageData`        | `ImageData`                | Pixel data for terrain rendering.          |
| `theme`            | `Theme`                    | Current theme applied to terrain colors.   |
| `game`             | `GameView`                 | Reference to the game view instance.       |
| `transformHandler` | `TransformHandler`         | Handles layer transformations and scaling. |

##### public constructor `constructor(game: GameView, transformHandler: TransformHandler)`

| Parameter          | Type               | Description                                |
| ------------------ | ------------------ | ------------------------------------------ |
| `game`             | `GameView`         | The game view instance.                    |
| `transformHandler` | `TransformHandler` | Handles layer transformations and scaling. |

Initializes the `TerrainLayer` with references to the game and transformation handler.

##### public function `shouldTransform()`

Returns `boolean`.

Determines whether this layer should apply transformations. Always returns `true`.

##### public function `tick()`

Returns `void`.

Updates the layer state. If the game's theme has changed from the last rendered `theme`, redraws the terrain layer.

##### public function `init()`

Returns `void`.

Initializes the terrain layer by drawing the canvas for the first time. Logs a message upon redraw.

##### protected function `redraw()`

Returns `void`.

Creates a new canvas sized to the game view, obtains the 2D rendering context, initializes image data, and renders it onto the canvas. Throws an error if 2D context is unsupported.

##### protected function `initImageData()`

Returns `void`.

Initializes pixel data for the terrain layer based on the current theme. Iterates over each tile in the game view and sets RGBA values according to the theme's terrain color.

##### public function `renderLayer(context: CanvasRenderingContext2D)`

| Parameter | Type                       | Description                                         |
| --------- | -------------------------- | --------------------------------------------------- |
| `context` | `CanvasRenderingContext2D` | Rendering context where the terrain layer is drawn. |

Returns `void`.

Draws the terrain canvas onto the given rendering context. Enables low-quality image smoothing if the scale is below 1; otherwise, disables smoothing.

### ./layers/TerritoryLayer.ts

#### class `TerritoryLayer`

Implements the `Layer` interface to manage territory visualization and highlights in the game view. Handles drawing, alternative views, spawn highlights, player borders, and queued tile rendering.

**Properties:**

| Name                             | Type                                                   | Description                                           |                                                          |
| -------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| `userSettings`                   | `UserSettings`                                         | User settings influencing rendering behavior.         |                                                          |
| `canvas`                         | `HTMLCanvasElement`                                    | Main canvas for territory rendering.                  |                                                          |
| `context`                        | `CanvasRenderingContext2D`                             | 2D rendering context for the main canvas.             |                                                          |
| `imageData`                      | `ImageData`                                            | Pixel data for territory layer.                       |                                                          |
| `alternativeImageData`           | `ImageData`                                            | Pixel data for alternative view mode.                 |                                                          |
| `borderAnimTime`                 | `number`                                               | Timer for breathing border animation.                 |                                                          |
| `cachedTerritoryPatternsEnabled` | `boolean                                               | undefined`                                            | Flag indicating if territory pattern caching is enabled. |
| `tileToRenderQueue`              | `PriorityQueue<{ tile: TileRef; lastUpdate: number }>` | Queue of tiles pending render updates.                |                                                          |
| `random`                         | `PseudoRandom`                                         | Random number generator instance for rendering order. |                                                          |
| `theme`                          | `Theme`                                                | Current theme applied to territory colors.            |                                                          |
| `highlightCanvas`                | `HTMLCanvasElement`                                    | Canvas for spawn and focus highlights.                |                                                          |
| `highlightContext`               | `CanvasRenderingContext2D`                             | 2D rendering context for highlights.                  |                                                          |
| `highlightedTerritory`           | `PlayerView                                            | null`                                                 | Currently highlighted territory, if any.                 |
| `alternativeView`                | `boolean`                                              | Indicates if alternative view mode is active.         |                                                          |
| `lastDragTime`                   | `number`                                               | Timestamp of last drag event.                         |                                                          |
| `nodrawDragDuration`             | `number`                                               | Duration to skip rendering during drag (ms).          |                                                          |
| `lastMousePosition`              | `{ x: number; y: number }                              | null`                                                 | Last mouse position for territory highlighting.          |
| `refreshRate`                    | `number`                                               | Minimum refresh interval (ms) for rendering.          |                                                          |
| `lastRefresh`                    | `number`                                               | Timestamp of last render.                             |                                                          |
| `lastFocusedPlayer`              | `PlayerView                                            | null`                                                 | Last player that had focus.                              |
| `game`                           | `GameView`                                             | Reference to the game view instance.                  |                                                          |
| `eventBus`                       | `EventBus`                                             | Event bus for input and updates.                      |                                                          |
| `transformHandler`               | `TransformHandler`                                     | Handles layer transformations and scaling.            |                                                          |

##### public constructor `constructor(game: GameView, eventBus: EventBus, transformHandler: TransformHandler, userSettings: UserSettings)`

| Parameter          | Type               | Description                              |
| ------------------ | ------------------ | ---------------------------------------- |
| `game`             | `GameView`         | Game view instance.                      |
| `eventBus`         | `EventBus`         | Event bus for input events.              |
| `transformHandler` | `TransformHandler` | Layer transformation handler.            |
| `userSettings`     | `UserSettings`     | User settings for rendering preferences. |

Initializes the territory layer with the game, event bus, transform handler, and user settings. Sets initial theme and cache flags.

##### public function `shouldTransform()`

Returns `boolean`.

Determines whether this layer should apply transformations. Always returns `true`.

##### public async function `paintPlayerBorder(player: PlayerView)`

| Parameter | Type         | Description                           |
| --------- | ------------ | ------------------------------------- |
| `player`  | `PlayerView` | Player whose border is to be painted. |

Returns `Promise<void>`.

Immediately paints all tiles along the player's border.

##### public function `tick()`

Returns `void`.

Updates territory highlights and enqueues tiles for rendering. Handles spawn phase highlights, unit updates, alliance changes, embargoes, and focused player borders.

##### private function `spawnHighlight()`

Returns `void`.

Updates spawn highlights for human players. Uses team colors or default highlight color and paints tiles within a defined radius from player centers.

##### private function `drawFocusedPlayerHighlight()`

Returns `void`.

Draws a breathing highlight ring around the currently focused player using `drawBreathingRing()`.

##### public function `init()`

Returns `void`.

Registers input event listeners for mouse-over, alternate view, and drag events. Initializes the layer by calling `redraw()`.

##### public function `onMouseOver(event: MouseOverEvent)`

| Parameter | Type             | Description                                  |
| --------- | ---------------- | -------------------------------------------- |
| `event`   | `MouseOverEvent` | Mouse-over event containing cursor position. |

Returns `void`.

Updates last mouse position and refreshes the highlighted territory.

##### private function `updateHighlightedTerritory()`

Returns `void`.

Determines the territory under the cursor in alternative view mode. Redraws borders if the highlighted territory changes.

##### private function `getTerritoryAtCell(cell: { x: number; y: number })`

| Parameter | Type                       | Description                |
| --------- | -------------------------- | -------------------------- |
| `cell`    | `{ x: number; y: number }` | Cell coordinates to check. |

Returns `PlayerView | null`. Returns `null` if cell is invalid or unowned.

##### public function `redraw()`

Returns `void`.

Recreates main and highlight canvases, initializes image data, and paints all tiles according to ownership and alternative view settings.

##### public function `redrawBorder(...players: PlayerView[])`

| Parameter | Type           | Description                              |
| --------- | -------------- | ---------------------------------------- |
| `players` | `PlayerView[]` | Players whose borders are to be redrawn. |

Returns `Promise<void[]>`.

Redraws the border tiles for the given players.

##### public function `initImageData()`

Returns `void`.

Clears all image data by setting alpha channels to 0.

##### public function `renderLayer(context: CanvasRenderingContext2D)`

| Parameter | Type                       | Description                      |
| --------- | -------------------------- | -------------------------------- |
| `context` | `CanvasRenderingContext2D` | Rendering context for the layer. |

Returns `void`.

Renders the territory and highlight canvases. Throttles updates according to `refreshRate` and drag state.

##### protected function `renderTerritory()`

Returns `void`.

Processes a batch of tiles from the render queue and paints them, including neighbor tiles for smooth border updates.

##### public function `paintTerritory(tile: TileRef, isBorder: boolean = false)`

| Parameter  | Type      | Description                                                       |
| ---------- | --------- | ----------------------------------------------------------------- |
| `tile`     | `TileRef` | Tile to paint.                                                    |
| `isBorder` | `boolean` | Optional; whether the tile is a border tile. Defaults to `false`. |

Returns `void`.

Paints a tile according to ownership, border status, alternative view, and highlight rules.

##### public function `alternateViewColor(other: PlayerView)`

| Parameter | Type         | Description                             |
| --------- | ------------ | --------------------------------------- |
| `other`   | `PlayerView` | Player whose color is to be determined. |

Returns `Colord`. Computes color for a tile in alternative view mode based on ownership, ally/enemy status, or neutrality.

##### public function `paintAlternateViewTile(tile: TileRef, other: PlayerView)`

| Parameter | Type         | Description                |
| --------- | ------------ | -------------------------- |
| `tile`    | `TileRef`    | Tile to paint.             |
| `other`   | `PlayerView` | Player whose color to use. |

Returns `void`.

Paints a tile in alternative view mode.

##### public function `paintTile(imageData: ImageData, tile: TileRef, color: Colord, alpha: number)`

| Parameter   | Type        | Description                 |
| ----------- | ----------- | --------------------------- |
| `imageData` | `ImageData` | ImageData buffer to modify. |
| `tile`      | `TileRef`   | Tile index to paint.        |
| `color`     | `Colord`    | Color to apply.             |
| `alpha`     | `number`    | Alpha transparency value.   |

Returns `void`.

Updates pixel data for a tile with the given color and alpha.

##### public function `clearTile(tile: TileRef)`

| Parameter | Type      | Description          |
| --------- | --------- | -------------------- |
| `tile`    | `TileRef` | Tile index to clear. |

Returns `void`.

Sets alpha to 0 in both `imageData` and `alternativeImageData`.

##### public function `clearAlternativeTile(tile: TileRef)`

| Parameter | Type      | Description                              |
| --------- | --------- | ---------------------------------------- |
| `tile`    | `TileRef` | Tile index to clear in alternative view. |

Returns `void`.

Sets alpha to 0 in `alternativeImageData` only.

##### public function `enqueueTile(tile: TileRef)`

| Parameter | Type      | Description                    |
| --------- | --------- | ------------------------------ |
| `tile`    | `TileRef` | Tile to enqueue for rendering. |

Returns `void`.

Adds a tile to the render queue with a small random offset to stagger updates.

##### public async function `enqueuePlayerBorder(player: PlayerView)`

| Parameter | Type         | Description                           |
| --------- | ------------ | ------------------------------------- |
| `player`  | `PlayerView` | Player whose border tiles to enqueue. |

Returns `Promise<void>`.

Enqueues all border tiles of a player for rendering.

##### public function `paintHighlightTile(tile: TileRef, color: Colord, alpha: number)`

| Parameter | Type      | Description               |
| --------- | --------- | ------------------------- |
| `tile`    | `TileRef` | Tile to highlight.        |
| `color`   | `Colord`  | Highlight color.          |
| `alpha`   | `number`  | Alpha transparency value. |

Returns `void`.

Paints a highlight tile on the highlight canvas.

##### public function `clearHighlightTile(tile: TileRef)`

| Parameter | Type      | Description                          |
| --------- | --------- | ------------------------------------ |
| `tile`    | `TileRef` | Tile to clear from highlight canvas. |

Returns `void`.

Clears a highlight tile.

##### private function `drawBreathingRing(cx: number, cy: number, minRad: number, maxRad: number, radius: number, transparentColor: Colord, breathingColor: Colord)`

| Parameter          | Type     | Description                              |
| ------------------ | -------- | ---------------------------------------- |
| `cx`               | `number` | Center x-coordinate.                     |
| `cy`               | `number` | Center y-coordinate.                     |
| `minRad`           | `number` | Minimum radius of the ring.              |
| `maxRad`           | `number` | Maximum radius of the ring.              |
| `radius`           | `number` | Current radius for breathing animation.  |
| `transparentColor` | `Colord` | Base color for transparent ring portion. |
| `breathingColor`   | `Colord` | Color used for breathing ring portion.   |

Returns `void`.

Draws a radial breathing highlight ring for spawn or focus effects.

### ./layers/UILayer.ts

#### class `UILayer`

Layer responsible for drawing UI elements that overlay the game, including selection boxes, health bars, and loading bars.

**Properties:**

| Name                     | Type                                                        | Description                                           |                                                      |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `canvas`                 | `HTMLCanvasElement`                                         | The internal canvas used to draw UI elements.         |                                                      |
| `context`                | `CanvasRenderingContext2D                                   | null`                                                 | Canvas rendering context for drawing operations.     |
| `theme`                  | `Theme                                                      | null`                                                 | Current theme used for UI colorization.              |
| `userSettings`           | `UserSettings`                                              | Stores user preferences for UI display.               |                                                      |
| `selectionAnimTime`      | `number`                                                    | Tracks animation time for selection box pulsation.    |                                                      |
| `allProgressBars`        | `Map<number, { unit: UnitView; progressBar: ProgressBar }>` | Tracks progress bars for units currently in progress. |                                                      |
| `allHealthBars`          | `Map<number, ProgressBar>`                                  | Tracks health bars for active units.                  |                                                      |
| `selectedUnit`           | `UnitView                                                   | null`                                                 | Currently selected unit.                             |
| `lastSelectionBoxCenter` | `{ x: number; y: number; size: number }                     | null`                                                 | Stores previous selection box position for clearing. |
| `SELECTION_BOX_SIZE`     | `number`                                                    | Size of selection boxes (constant).                   |                                                      |
| `game`                   | `GameView`                                                  | Reference to the main game view.                      |                                                      |
| `eventBus`               | `EventBus`                                                  | Event bus for subscribing to game events.             |                                                      |
| `transformHandler`       | `TransformHandler`                                          | Handles coordinate transformations for drawing.       |                                                      |

##### public function `shouldTransform()`

Returns `boolean`.

Determines whether this layer should apply coordinate transformations. Always returns `true`.

##### public function `tick()`

Returns `void`.

Updates animation states and UI elements:

- Increments `selectionAnimTime`.
- Redraws selection box for selected warships.
- Processes unit updates since the last tick.
- Updates progress bars.

##### public function `init()`

Returns `void`.

Initializes the UI layer:

- Subscribes to unit selection events.
- Calls `redraw()` to initialize the canvas.

##### public function `renderLayer()`

| Parameter | Type                       | Description                       |
| --------- | -------------------------- | --------------------------------- |
| `context` | `CanvasRenderingContext2D` | Context to render the layer onto. |

Returns `void`.

Draws the internal canvas onto the provided context, centered on the game view.

##### public function `redraw()`

Returns `void`.

Creates a new internal canvas and obtains its rendering context. Sets canvas size to match game dimensions.

##### private function `onUnitEvent()`

| Parameter | Type       | Description                          |
| --------- | ---------- | ------------------------------------ |
| `unit`    | `UnitView` | The unit whose UI state has changed. |

Returns `void`.

Updates UI elements based on unit type and state:

- Creates loading bars for constructions or partially ready units.
- Draws health bars for warships.
- Skips inactive or undefined units.

##### private function `clearIcon()`

| Parameter | Type               | Description                    |
| --------- | ------------------ | ------------------------------ |
| `icon`    | `HTMLImageElement` | Icon to clear.                 |
| `startX`  | `number`           | X-coordinate of icon position. |
| `startY`  | `number`           | Y-coordinate of icon position. |

Returns `void`.

Clears the area occupied by the icon on the internal canvas.

##### private function `drawIcon()`

| Parameter | Type               | Description               |
| --------- | ------------------ | ------------------------- |
| `icon`    | `HTMLImageElement` | Icon image to draw.       |
| `unit`    | `UnitView`         | Unit owning the icon.     |
| `startX`  | `number`           | X-coordinate for drawing. |
| `startY`  | `number`           | Y-coordinate for drawing. |

Returns `void`.

Draws a filled rectangle using the unit's border color, then overlays the icon image.

##### private function `onUnitSelection()`

| Parameter | Type                 | Description                            |
| --------- | -------------------- | -------------------------------------- |
| `event`   | `UnitSelectionEvent` | Event containing unit selection state. |

Returns `void`.

Handles selection events:

- Sets or clears `selectedUnit`.
- Draws or clears the selection box as appropriate.

##### private function `clearSelectionBox()`

| Parameter | Type     | Description                               |
| --------- | -------- | ----------------------------------------- |
| `x`       | `number` | Center X-coordinate of the selection box. |
| `y`       | `number` | Center Y-coordinate of the selection box. |
| `size`    | `number` | Half-size of the selection box.           |

Returns `void`.

Clears the selection box border by clearing cells around the specified coordinates.

##### public function `drawSelectionBox()`

| Parameter | Type       | Description                                   |
| --------- | ---------- | --------------------------------------------- |
| `unit`    | `UnitView` | Unit around which the selection box is drawn. |

Returns `void`.

Draws a pulsating selection box for active units:

- Calculates opacity based on `selectionAnimTime`.
- Uses owner color brightened by 20%.
- Clears previous box if the unit has moved.

See also: [private function `clearSelectionBox()`](#private-function-clearselectionbox)

##### public function `drawHealthBar()`

| Parameter | Type       | Description                          |
| --------- | ---------- | ------------------------------------ |
| `unit`    | `UnitView` | Warship unit to draw health bar for. |

Returns `void`.

Draws a health bar for active warships:

- Clears existing bar if health is full or unit is inactive.
- Creates new `ProgressBar` if unit has partial health.

##### private function `updateProgressBars()`

Returns `void`.

Updates all active progress bars:

- Increments progress.
- Clears bars that have reached completion.

##### private function `getProgress()`

| Parameter | Type       | Description                     |
| --------- | ---------- | ------------------------------- |
| `unit`    | `UnitView` | Unit to calculate progress for. |

Returns `number`.

Computes progress for constructions, missile silos, and deletable units:

- Returns `1` for inactive or undefined units.
- Calculates construction completion or deletion progress.

##### private function `deletionProgress()`

| Parameter | Type       | Description               |
| --------- | ---------- | ------------------------- |
| `game`    | `GameView` | Current game view.        |
| `unit`    | `UnitView` | Unit marked for deletion. |

Returns `number`.

Calculates progress based on remaining ticks until deletion. Returns `1` if unit is not marked for deletion.

##### public function `createLoadingBar()`

| Parameter | Type       | Description                       |
| --------- | ---------- | --------------------------------- |
| `unit`    | `UnitView` | Unit to create a loading bar for. |

Returns `void`.

Creates a new `ProgressBar` for units in progress if one does not already exist.

See also: [private function `updateProgressBars()`](#private-function-updateprogressbars)

##### public function `paintCell()`

| Parameter | Type     | Description                 |
| --------- | -------- | --------------------------- |
| `x`       | `number` | X-coordinate of the cell.   |
| `y`       | `number` | Y-coordinate of the cell.   |
| `color`   | `Colord` | Color to paint.             |
| `alpha`   | `number` | Alpha transparency (0-255). |

Returns `void`.

Paints a single pixel on the canvas with the specified color and alpha.

##### public function `clearCell()`

| Parameter | Type     | Description               |
| --------- | -------- | ------------------------- |
| `x`       | `number` | X-coordinate of the cell. |
| `y`       | `number` | Y-coordinate of the cell. |

Returns `void`.

Clears a single pixel on the internal canvas.

### ./layers/UnitDisplay.ts

#### class `UnitDisplay`

Displays unit counts and build options in the UI. Provides interactive unit selection and hotkey overlays.

**Properties:**

| Name            | Type                                             | Description                                           |                                                  |
| --------------- | ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| `game`          | `GameView`                                       | Reference to the current game view.                   |                                                  |
| `eventBus`      | `EventBus`                                       | Event bus for subscribing and emitting events.        |                                                  |
| `uiState`       | `UIState`                                        | Tracks current UI state, including ghost structures.  |                                                  |
| `playerActions` | `PlayerActions                                   | null`                                                 | Tracks available buildable units for the player. |
| `keybinds`      | `Record<string, { value: string; key: string }>` | Stores keybinds loaded from local storage.            |                                                  |
| `_cities`       | `number`                                         | Count of City units.                                  |                                                  |
| `_warships`     | `number`                                         | Count of Warship units.                               |                                                  |
| `_factories`    | `number`                                         | Count of Factory units.                               |                                                  |
| `_missileSilo`  | `number`                                         | Count of Missile Silo units.                          |                                                  |
| `_port`         | `number`                                         | Count of Port units.                                  |                                                  |
| `_defensePost`  | `number`                                         | Count of Defense Post units.                          |                                                  |
| `_samLauncher`  | `number`                                         | Count of SAM Launcher units.                          |                                                  |
| `allDisabled`   | `boolean`                                        | Indicates if all units are disabled in configuration. |                                                  |
| `_hoveredUnit`  | `UnitType                                        | null`                                                 | Currently hovered unit type for tooltip display. |

##### public function `createRenderRoot()`

Returns `this`.

Overrides LitElement's `createRenderRoot` to render directly in the light DOM.

##### public function `init()`

Returns `void`.

Initializes the unit display:

- Loads saved keybinds from local storage.
- Checks which units are disabled and sets `allDisabled` flag.
- Triggers an update of the component.

##### private function `cost()`

| Parameter | Type       | Description             |
| --------- | ---------- | ----------------------- |
| `item`    | `UnitType` | The unit type to query. |

Returns `Gold`.

Returns the cost of the given unit type based on `playerActions`. Returns `0n` if the unit is not buildable.

##### private function `canBuild()`

| Parameter | Type       | Description                               |
| --------- | ---------- | ----------------------------------------- |
| `item`    | `UnitType` | Unit type to check for build eligibility. |

Returns `boolean`.

Determines if the player can build the specified unit:

- Considers unit disable status, available gold, and prerequisite structures.

##### public function `tick()`

Returns `void`.

Updates unit counts from the player's current units and refreshes `playerActions`. Triggers component re-render.

##### public function `render()`

Returns `TemplateResult | null`.

Renders the unit display UI:

- Returns `null` if the game or player is not available, in spawn phase, or if all units are disabled.
- Builds two UI sections: regular units and military units (warships and nuclear devices).
- Each unit is rendered via `renderUnitItem()`.

##### private function `renderUnitItem()`

| Parameter      | Type       | Description                                |                                           |
| -------------- | ---------- | ------------------------------------------ | ----------------------------------------- |
| `icon`         | `string`   | URL or import of the unit icon image.      |                                           |
| `number`       | `number    | null`                                      | Count of units, `null` if not applicable. |
| `unitType`     | `UnitType` | Unit type being rendered.                  |                                           |
| `structureKey` | `string`   | Key used for translations and identifiers. |                                           |
| `hotkey`       | `string`   | Assigned hotkey for building this unit.    |                                           |

Returns `TemplateResult`.

Renders a single unit UI element:

- Hides element if unit is disabled.
- Displays tooltip on hover with name, description, and cost.
- Shows hotkey in the top-left corner.
- Handles click to select/deselect ghost structure in `uiState`.
- Emits `ToggleStructureEvent` to show or hide related structures when hovered.

See also: [function `cost()`](#private-function-cost), [function `canBuild()`](#private-function-canbuild)

### ./layers/UnitLayer.ts

#### class `UnitLayer`

Manages rendering of all units and their movement trails. Handles unit selection, movement intents, and alternate view overlays.

**Properties:**

| Name                       | Type                       | Description                                                |                          |
| -------------------------- | -------------------------- | ---------------------------------------------------------- | ------------------------ |
| `canvas`                   | `HTMLCanvasElement`        | Main canvas for unit sprites.                              |                          |
| `context`                  | `CanvasRenderingContext2D` | 2D rendering context of `canvas`.                          |                          |
| `transportShipTrailCanvas` | `HTMLCanvasElement`        | Canvas for rendering transport ship trails.                |                          |
| `unitTrailContext`         | `CanvasRenderingContext2D` | 2D context for unit trails.                                |                          |
| `unitToTrail`              | `Map<UnitView, TileRef[]>` | Tracks the tile trail for each moving unit.                |                          |
| `theme`                    | `Theme`                    | Current theme for color configuration.                     |                          |
| `alternateView`            | `boolean`                  | Indicates if alternate coloring view is active.            |                          |
| `oldShellTile`             | `Map<UnitView, TileRef>`   | Tracks previous positions for shell units.                 |                          |
| `transformHandler`         | `TransformHandler`         | Converts between screen and world coordinates.             |                          |
| `selectedUnit`             | `UnitView                  | null`                                                      | Currently selected unit. |
| `WARSHIP_SELECTION_RADIUS` | `number`                   | Radius for selecting warships near a click, in game cells. |                          |

##### public function `shouldTransform()`

Returns `boolean`.

Indicates that this layer should be transformed based on game world coordinates.

##### public function `tick()`

Returns `void`.

Updates unit sprites based on changes since the last tick.

##### public function `init()`

Returns `void`.

Initializes event listeners and loads all sprites. Subscribes to:

- `AlternateViewEvent`
- `MouseUpEvent`
- `UnitSelectionEvent`

##### private function `findWarshipsNearCell()`

| Parameter | Type                       | Description                                     |
| --------- | -------------------------- | ----------------------------------------------- |
| `cell`    | `{ x: number; y: number }` | World coordinates to check for nearby warships. |

Returns `UnitView[]`.

Finds player-owned warships near the given cell within `WARSHIP_SELECTION_RADIUS`, sorted by proximity.

##### private function `onMouseUp()`

| Parameter | Type           | Description                                        |
| --------- | -------------- | -------------------------------------------------- |
| `event`   | `MouseUpEvent` | Mouse release event containing screen coordinates. |

Returns `void`.

Handles warship selection and movement intents on mouse release.

##### private function `onUnitSelectionChange()`

| Parameter | Type                 | Description                                  |
| --------- | -------------------- | -------------------------------------------- |
| `event`   | `UnitSelectionEvent` | Event indicating unit selection/deselection. |

Returns `void`.

Updates `selectedUnit` based on selection events.

##### private function `handleUnitDeactivation()`

| Parameter | Type       | Description                     |
| --------- | ---------- | ------------------------------- |
| `unit`    | `UnitView` | Unit to check for deactivation. |

Returns `void`.

Deselects a unit if it has been deactivated.

##### public function `renderLayer()`

| Parameter | Type                       | Description               |
| --------- | -------------------------- | ------------------------- |
| `context` | `CanvasRenderingContext2D` | Target rendering context. |

Returns `void`.

Draws the unit and trail canvases onto the provided context.

##### public function `onAlternativeViewEvent()`

| Parameter | Type                 | Description                         |
| --------- | -------------------- | ----------------------------------- |
| `event`   | `AlternateViewEvent` | Event toggling alternate view mode. |

Returns `void`.

Sets `alternateView` and redraws the layer.

##### public function `redraw()`

Returns `void`.

Creates canvases and contexts for units and trails. Clears and repaints all units and trails.

##### private function `updateUnitsSprites()`

| Parameter | Type       | Description                 |
| --------- | ---------- | --------------------------- |
| `unitIds` | `number[]` | List of unit IDs to update. |

Returns `void`.

Clears and redraws the sprites of the specified units.

##### private function `clearUnitsCells()`

| Parameter   | Type         | Description                     |
| ----------- | ------------ | ------------------------------- |
| `unitViews` | `UnitView[]` | Units to clear from the canvas. |

Returns `void`.

Clears the previous sprite positions of active units.

##### private function `drawUnitsCells()`

| Parameter   | Type         | Description    |
| ----------- | ------------ | -------------- |
| `unitViews` | `UnitView[]` | Units to draw. |

Returns `void`.

Draws each unit using `onUnitEvent()`.

##### private function `relationship()`

| Parameter | Type       | Description                                          |
| --------- | ---------- | ---------------------------------------------------- |
| `unit`    | `UnitView` | Unit whose relationship to the player is determined. |

Returns `Relationship`.

Determines if the unit belongs to self, ally, or enemy.

##### public function `onUnitEvent()`

| Parameter | Type       | Description      |
| --------- | ---------- | ---------------- |
| `unit`    | `UnitView` | Unit to process. |

Returns `void`.

Dispatches unit handling to specialized methods based on unit type. Deselects deactivated units.

##### private function `handleWarShipEvent()`

| Parameter | Type       | Description           |
| --------- | ---------- | --------------------- |
| `unit`    | `UnitView` | Warship unit to draw. |

Returns `void`.

Draws warship sprite with optional red target indicator.

##### private function `handleShellEvent()`

| Parameter | Type       | Description            |
| --------- | ---------- | ---------------------- |
| `unit`    | `UnitView` | Shell unit to process. |

Returns `void`.

Clears previous positions and paints current and last positions of shell units.

##### private function `handleMissileEvent()`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | Missile unit to process. |

Returns `void`.

Draws interception missiles.

##### private function `drawTrail()`

| Parameter | Type           | Description                             |
| --------- | -------------- | --------------------------------------- |
| `trail`   | `number[]`     | Tile indices for the trail.             |
| `color`   | `Colord`       | Color of the trail.                     |
| `rel`     | `Relationship` | Unit relationship determining coloring. |

Returns `void`.

Paints a trail of tiles for moving units.

##### private function `clearTrail()`

| Parameter | Type       | Description                  |
| --------- | ---------- | ---------------------------- |
| `unit`    | `UnitView` | Unit whose trail is cleared. |

Returns `void`.

Removes the unit's trail from the canvas and repaints overlapping trails.

##### private function `handleNuke()`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | Nuclear unit to process. |

Returns `void`.

Draws the trail and sprite of nukes. Clears trail if inactive. Supports line interpolation for fast-moving units.

##### private function `handleMIRVWarhead()`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | MIRV warhead to process. |

Returns `void`.

Paints MIRV warhead position and clears last tile.

##### private function `handleTradeShipEvent()`

| Parameter | Type       | Description              |
| --------- | ---------- | ------------------------ |
| `unit`    | `UnitView` | Trade ship unit to draw. |

Returns `void`.

Draws trade ship sprite.

##### private function `handleTrainEvent()`

| Parameter | Type       | Description         |
| --------- | ---------- | ------------------- |
| `unit`    | `UnitView` | Train unit to draw. |

Returns `void`.

Draws train sprite.

##### private function `handleBoatEvent()`

| Parameter | Type       | Description                  |
| --------- | ---------- | ---------------------------- |
| `unit`    | `UnitView` | Transport ship unit to draw. |

Returns `void`.

Draws boat sprite with trail and clears trail if inactive.

##### public function `paintCell()`

| Parameter      | Type                       | Description                                   |
| -------------- | -------------------------- | --------------------------------------------- |
| `x`            | `number`                   | X coordinate in canvas pixels.                |
| `y`            | `number`                   | Y coordinate in canvas pixels.                |
| `relationship` | `Relationship`             | Relationship of unit to player.               |
| `color`        | `Colord`                   | Base color.                                   |
| `alpha`        | `number`                   | Alpha transparency (0–255).                   |
| `context`      | `CanvasRenderingContext2D` | Optional context; defaults to main `context`. |

Returns `void`.

Paints a single canvas pixel according to relationship or color and alpha.

##### public function `clearCell()`

| Parameter | Type                       | Description                                   |
| --------- | -------------------------- | --------------------------------------------- |
| `x`       | `number`                   | X coordinate in canvas pixels.                |
| `y`       | `number`                   | Y coordinate in canvas pixels.                |
| `context` | `CanvasRenderingContext2D` | Optional context; defaults to main `context`. |

Returns `void`.

Clears a single pixel in the given canvas context.

##### public function `drawSprite()`

| Parameter               | Type       | Description                         |
| ----------------------- | ---------- | ----------------------------------- |
| `unit`                  | `UnitView` | Unit to draw.                       |
| `customTerritoryColor?` | `Colord`   | Optional custom color for the unit. |

Returns `void`.

Draws the unit's sprite on the canvas, applying alternate view coloring or opacity adjustments if the unit is not targetable.

See also: [function `paintCell()`](#public-function-paintcell), [function `clearCell()`](#public-function-clearcell)

### ./layers/WinModal.ts

#### class `WinModal`

Manages the display and interaction of the win modal, including showing victory messages, pattern support buttons, and handling user actions.

Implements: [interface `Layer`](#interface-layer)

**Properties:**

| Name                 | Type            | Description                                                                            |                                                                                             |
| -------------------- | --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `game`               | `GameView`      | The current game view instance.                                                        |                                                                                             |
| `eventBus`           | `EventBus`      | Event bus used to emit game events.                                                    |                                                                                             |
| `hasShownDeathModal` | `boolean`       | Tracks whether the death modal has already been displayed.                             |                                                                                             |
| `isVisible`          | `boolean`       | Indicates if the modal is currently visible. Managed as a reactive `@state()`.         |                                                                                             |
| `showButtons`        | `boolean`       | Determines whether the action buttons are displayed. Managed as a reactive `@state()`. |                                                                                             |
| `isWin`              | `boolean`       | Indicates if the current outcome is a win. Managed as a private reactive `@state()`.   |                                                                                             |
| `patternContent`     | `TemplateResult | null`                                                                                  | Stores dynamically loaded pattern button content. Managed as a private reactive `@state()`. |
| `_title`             | `string`        | Stores the modal title for display.                                                    |                                                                                             |
| `rand`               | `number`        | Random number used to determine modal content fallback.                                |                                                                                             |

##### public constructor `constructor()`

Initializes a `WinModal` instance. Overrides shadow DOM creation to use the light DOM.

##### public function `createRenderRoot()`

Returns `this`.

Overrides default LitElement behavior to prevent creation of a shadow DOM.

##### public function `render()`

Returns `TemplateResult`.

Renders the modal container, title, content (pattern buttons or Steam wishlist), and action buttons. Applies animation classes when visible.

##### public function `innerHtml()`

Returns `TemplateResult`.

Determines which inner content to render: either pattern buttons via [function `renderPatternButton()`](#public-function-renderpatternbutton) or a Steam wishlist link via [function `steamWishlist()`](#public-function-steamwishlist).

##### public function `renderPatternButton()`

Returns `TemplateResult`.

Renders the container for the support pattern button, including title, description, and dynamically loaded `patternContent`.

##### public async function `loadPatternContent()`

Returns `Promise<void>`.

Loads and filters purchasable patterns for the current user. Dynamically creates `pattern-button` elements and sets `patternContent`. Falls back to empty content if no purchasable patterns exist.

##### public function `steamWishlist()`

Returns `TemplateResult`.

Renders a Steam wishlist link as fallback content if inside an iframe or based on random chance.

##### public async function `show()`

Returns `Promise<void>`.

Displays the modal by loading pattern content, setting visibility, and revealing buttons after a delay.

##### public function `hide()`

Returns `void`.

Hides the modal and action buttons.

##### private function `_handleExit()`

Returns `void`.

Hides the modal and redirects the user to the home page.

##### public function `init()`

Returns `void`.

Implements [interface `Layer`](#interface-layer). Placeholder initialization function.

##### public function `tick()`

Returns `void`.

Checks game state updates and displays the modal when appropriate, such as on death or victory. Emits [class `SendWinnerEvent`](#class-sendwinnevent) via `eventBus` when a winner is detected. Updates `_title` and `isWin` accordingly.

##### public function `renderLayer()`

Returns `void`.

Implements [interface `Layer`](#interface-layer). Placeholder for rendering to canvas.

##### public function `shouldTransform()`

Returns `boolean`.

Indicates whether the layer requires canvas transformation. Always returns `false`.

## Style

## Data

## Sound

### SoundManager.ts

#### enum `SoundEffect`

Enum of sound effects and their respective names.

#### class `SoundManager`

Manages playing, stopping, loading, unloading, and changing volume of music and SFX.

**Properties:**

| Name           | Type                        | Description                        |
| -------------- | --------------------------- | ---------------------------------- |
| `music`        | `Howl`                      | Current background music instance. |
| `soundEffects` | `Record<SoundEffect, Howl>` | Map of sound effects.              |

##### public function `playBackgroundMusic()`

Returns `void`.

##### public function `stopBackgroundMusic()`

Returns `void`.

##### public function `setBackgroundMusicVolume()`

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `volume`  | `number` | Volume between 0 and 1. |

Returns `void`.

##### public function `loadSoundEffect()`

| Parameter | Type          | Description                     |
| --------- | ------------- | ------------------------------- |
| `name`    | `SoundEffect` | Sound effect identifier.        |
| `src`     | `string`      | Source file path for the sound. |

Returns `void`.

##### public function `playSoundEffect()`

| Parameter | Type          | Description           |
| --------- | ------------- | --------------------- |
| `name`    | `SoundEffect` | Sound effect to play. |

Returns `void`.

##### public function `setSoundEffectsVolume()`

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `volume`  | `number` | Volume between 0 and 1. |

Returns `void`.

##### public function `stopSoundEffect()`

| Parameter | Type          | Description           |
| --------- | ------------- | --------------------- |
| `name`    | `SoundEffect` | Sound effect to stop. |

Returns `void`.

##### public function `unloadSoundEffect()`

| Parameter | Type          | Description             |
| --------- | ------------- | ----------------------- |
| `name`    | `SoundEffect` | Sound effect to unload. |

Returns `void`.

## Utilities

### ReplaySpeedMultiplier.ts

#### enum `ReplaySpeedMultiplier`

Enum containing speed multiplier names (`string`) and their values (`number`).

#### const `defaultReplaySpeedMultiplier`

The default replay speed multiplier.

### RenderUnitTypeOptions.ts

#### interface `UnitTypeRenderContext`

| Property        | Type                                         | Description                             |
| --------------- | -------------------------------------------- | --------------------------------------- |
| `disabledUnits` | `UnitType[]`                                 | Array of disabled units.                |
| `toggleUnit`    | `(unit: UnitType, checked: boolean) => void` | Function to toggle a unit's visibility. |

#### const `unitOptions`

Array of objects containing unit types (`UnitType`) and their translation keys (`string`).

#### function `renderUnitTypeOptions()`

| Parameter | Type                    | Description                           |
| --------- | ----------------------- | ------------------------------------- |
| `context` | `UnitTypeRenderContext` | The rendering context for unit types. |

Returns `TemplateResult[]` — an array of [lit-html](#) template strings, each containing the HTML for a unit type and a checkbox.
