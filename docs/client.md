# Client reference

## Graphics

## Style

## Data

## Sound

### SoundManager.ts

#### enum SoundEffect

Enum of sound effects and their respective names

#### class SoundManager

##### constructor()

This class takes no parameters to construct.

Uses Howler howl() to set the background music, and loads sound effects.

##### playBackgroundMusic()

Plays the current music track.

##### stopBackgroundMusic()

Stops the current music track.

##### setBackgroundMusicVolume()

Takes a `volume: number` parameter.

Sets the music volume to `volume`

##### loadSoundEffect()

Takes `name: SoundEffect` `src: string`

Loads or changes the src of a Howl sound effect.

##### playSoundEffect()

Takes `name: SoundEffect`

Plays `name`.

##### setSoundEffectsVolume()

Takes `volume: number`

Sets SFX folume to volume

##### stopSoundEffect()

Takes `name: SoundEffect`

Stops name.

##### unloadSoundEffect()

Takes `name: SoundEffect`

Unloads name and deletes it from `soundEffects`

## Utilities

### ReplaySpeedMultiplier.ts

#### enum ReplaySpeedMultiplier

Enum containing speed multiplier values

#### const defaultReplaySpeedMultiplier

The default replay speed multiplier

### RenderUnitTypeOptions.ts

#### interface UnitTypeRenderContext

* `disabledUnits: UnitType[]` - array of disabled units
* `toggleUnit: (unit: UnitType, checked: boolean) => void` - function to toggle a unit's visibility 

#### const unitOptions

array of object containing unit types and their translation keys

#### function renderUnitTypeOptions()

Takes a `UnitTypeRenderContext` interface as a parameter, returns `TemplateResult[]`

Returns an array of `TemplateResult`s (html strings) with each one holding the html for a unit type and a checkbox.


