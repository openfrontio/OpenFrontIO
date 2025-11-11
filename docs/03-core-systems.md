# Core Game Systems

This document explains the core game systems and mechanics in detail.

## Table of Contents

1. [Territory System](#territory-system)
2. [Resource System](#resource-system)
3. [Unit System](#unit-system)
4. [Combat System](#combat-system)
5. [Alliance System](#alliance-system)
6. [Diplomacy System](#diplomacy-system)
7. [Map System](#map-system)

## Territory System

### Territory Ownership

Each tile on the map belongs to a player or is unclaimed (TerraNullius). Players expand by conquering adjacent tiles.

### Conquering Territory

**Ground Attacks:**

- Players attack adjacent enemy or neutral tiles
- Attack consumes troops
- Attack speed depends on terrain type:
  - Plains: Fastest
  - Highland: Medium
  - Mountain: Slowest
- Defense Posts provide defensive bonuses

**Naval Attacks:**

- Transport Ships carry troops across water
- Warships provide naval support
- Ports enable naval unit construction

### Border Tiles

Border tiles are tiles owned by a player that are adjacent to enemy or neutral territory. These are important for:

- Attack initiation
- Defense positioning
- Unit placement

## Resource System

### Gold

Gold is the primary currency used for:

- Building units and structures
- Upgrading structures

**Gold Generation:**

- Cities generate gold over time
- Trade Ships generate gold from trading
- Trains generate gold from transportation
- Gold generation rate increases with more structures

**Gold Costs:**

- Unit costs scale with number of units owned
- More units = higher cost per unit (exponential scaling)

### Troops

Troops represent military strength used for:

- Attacking territory
- Defending territory
- Naval invasions

**Troop Generation:**

- Base generation rate per tick
- Cities increase generation rate
- Maximum troops capped based on territory size

**Troop Usage:**

- Attacks consume troops
- Troops lost in combat
- Can be donated to allies

## Unit System

### Unit Types

#### Structures

**City**

- Generates gold and troops
- Can be upgraded (increases generation)
- Territory-bound (captured when tile conquered)

**Port**

- Enables naval unit construction
- Generates Trade Ships
- Can build Train Stations
- Upgradable

**Defense Post**

- Provides defensive bonuses to nearby tiles
- Attacks nearby enemy units
- Territory-bound

**SAM Launcher**

- Defends against nuclear weapons
- Can intercept missiles
- Has cooldown between launches
- Upgradable (increases range)

**Missile Silo**

- Launches nuclear weapons
- Stores and launches Atom Bombs, Hydrogen Bombs, MIRVs
- Has cooldown between launches

**Factory**

- Generates Trains
- Connects to Train Stations
- Territory-bound

#### Mobile Units

**Transport Ship**

- Carries troops across water
- Enables naval invasions
- Can retreat

**Warship**

- Naval combat unit
- Fires shells at land targets
- Patrols assigned areas
- Has health and can be destroyed

**Trade Ship**

- Generates gold from trading
- Travels between ports
- Can be protected from pirates (Warships)

**Train**

- Transports resources
- Requires Train Stations
- Connects Factories to Cities
- Generates gold based on distance

#### Projectiles

**Shell**

- Fired by Warships and Defense Posts
- Damages units and structures
- Limited lifetime

**SAM Missile**

- Fired by SAM Launchers
- Intercepts nuclear weapons
- Has chance to hit target

#### Nuclear Weapons

**Atom Bomb**

- Nuclear weapon
- Destroys units and creates fallout
- Can be intercepted by SAMs

**Hydrogen Bomb**

- More powerful than Atom Bomb
- Larger blast radius
- Higher cost

**MIRV (Multiple Independently Targetable Reentry Vehicle)**

- Splits into multiple warheads
- Very expensive
- Difficult to intercept

**MIRV Warhead**

- Individual warhead from MIRV
- Targets specific tiles

### Unit Properties

**Territory-Bound:**

- Units that change ownership when tile is conquered
- Examples: City, Port, Defense Post

**Health:**

- Some units have health and can be damaged
- Examples: Warship, Defense Post

**Construction Duration:**

- Time to build structure
- Can be instant in some game modes

**Upgradable:**

- Structures that can be upgraded
- Upgrading increases effectiveness
- Examples: City, Port, SAM Launcher

### Unit Construction

**Requirements:**

- Sufficient gold
- Valid tile location
- Territory ownership
- Distance from other structures (if applicable)

**Construction Process:**

1. Player selects unit type
2. System checks if can build
3. Gold deducted
4. Construction Execution created
5. Unit appears after construction duration

## Combat System

### Ground Combat

**Attack Mechanics:**

- Attack consumes troops from attacker
- Attack speed based on terrain
- Defense Posts provide bonuses
- Fallout slows attacks

**Combat Resolution:**

- Troops lost based on terrain and defenses
- Tiles conquered when attack succeeds
- Attack continues until:
  - All troops consumed
  - Target eliminated
  - Attack retreated

**Attack Types:**

- **Expansion**: Attacking neutral territory
- **Conquest**: Attacking enemy territory
- **Naval Invasion**: Attacking from sea

### Naval Combat

**Warship Combat:**

- Warships patrol assigned areas
- Fire shells at land targets
- Can be targeted by other Warships
- Health-based system

**Naval Invasions:**

- Transport Ships carry troops
- Land on enemy shores
- Create ground attacks
- Can retreat if needed

### Nuclear Combat

**Nuclear Weapons:**

- Destroy units in blast radius
- Create fallout zones
- Fallout persists for many ticks
- Can break alliances if used against allies

**SAM Defense:**

- SAM Launchers can intercept nukes
- Interception chance based on SAM level
- Multiple SAMs increase interception chance

## Alliance System

### Alliance Creation

**Alliance Request:**

1. Player sends alliance request
2. Request expires after duration
3. Recipient can accept or reject
4. If accepted, alliance created

**Alliance Properties:**

- Temporary (expires after duration)
- Can be extended by mutual agreement
- Can be broken by either player
- Prevents attacks between allies

### Alliance Benefits

- Cannot attack each other
- Can donate resources
- Can send emojis
- Shared defense (indirect)

### Alliance Extension

- Both players must agree to extend
- Extension requests expire
- Alliance duration resets on extension

### Alliance Breaking

- Either player can break alliance
- Breaking alliance updates relations negatively
- Breaking alliance allows attacks immediately

## Diplomacy System

### Relations

**Relation Levels:**

- **Hostile** (0): Can attack, negative relations
- **Distrustful** (1): Negative but not hostile
- **Neutral** (2): Default state
- **Friendly** (3): Positive relations

**Relation Changes:**

- Attacking decreases relations
- Donating increases relations
- Alliances increase relations
- Relations decay over time

### Diplomatic Actions

**Emojis:**

- Send emojis to players
- Can send to all players (global)
- Cooldown between sends

**Donations:**

- Donate gold to players
- Donate troops to players
- Cooldown between donations
- Requires friendly relations

**Targeting:**

- Mark players as targets
- Visual indicator for targeting
- Cooldown between target changes

**Embargo:**

- Block trade with specific players
- Temporary or permanent
- Can embargo all players (global)

## Map System

### Map Types

**Terrain Types:**

- **Plains**: Fast movement, easy to conquer
- **Highland**: Medium speed
- **Mountain**: Slow movement, defensive advantage
- **Lake**: Water tile, requires naval units
- **Ocean**: Deep water, requires naval units

### Map Features

**Nations:**

- NPC-controlled territories
- Spawn at game start
- Can be conquered
- Provide challenge for players

**Spawn Points:**

- Players spawn at specific locations
- Can be random or selected
- Spawn phase allows placement

### Map Loading

**Map Format:**

- Binary format for efficiency
- Includes terrain data
- Includes nation data
- Includes spawn points

**Map Categories:**

- Continental (large maps)
- Regional (medium maps)
- Fantasy (custom maps)

## Game Phases

### Spawn Phase

- Players select spawn locations
- Limited actions available
- NPCs spawn automatically
- Duration: Configurable ticks

### Game Phase

- Full gameplay available
- All systems active
- Players compete for victory
- Continues until win condition

### End Phase

- Winner determined
- Game archived
- Statistics recorded
- Replay available

## Win Conditions

**Victory Types:**

- **Territory Control**: Own percentage of map
- **Elimination**: All enemies eliminated
- **Team Victory**: Team owns percentage of map

## Next Steps

- Learn about [Execution System](./05-execution-system.md) to understand how actions are processed
- Read [Adding New Features](./06-adding-features.md) to extend these systems
- Check [Development Guide](./07-development.md) for implementation details
