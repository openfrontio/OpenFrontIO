# Competitive Scoring Rules

This document explains how the competitive scoring system works in OpenFront team matches. It is intended for tournament hosts, players, and casters.

---

## How to Enable

In a **private lobby**, toggle **"Competitive Scoring"** in the options section. This option only appears when the game mode is set to Teams.

---

## Overview

Each match awards up to **100 points** per team, split across three categories:

| Category        | Max Points | What It Measures                           |
| --------------- | ---------- | ------------------------------------------ |
| Max Tiles       | 60         | Peak map control during the match          |
| Crown Time      | 30         | How long your team held the most territory |
| Final Placement | 10         | How long your team survived                |

The team with the most total points finishes **#1 on the competitive scoreboard**.

The actual game winner is still determined by normal game win conditions (territory threshold / timer), so the match winner and competitive #1 can differ.

---

## Category Breakdown

### 1. Max Tiles (60 points)

This is the **highest percentage of the map your team controlled at any point** during the match. It does not matter if you lose that territory later — only your peak matters.

Teams are ranked by their peak tile percentage, and points are awarded by rank.

### 2. Crown Time (30 points)

The **Crown** belongs to whichever team currently controls the most tiles on the map. All members of the crowned team display a crown icon.

Crown Time tracks how long your team held the crown during the match, as a ratio of total game time. A team that held the crown for half the match has a crown ratio of 50%.

Teams are ranked by their crown ratio, and points are awarded by rank.

**Attacking the crown team grants a 25% troop bonus**, encouraging teams to contest the leading team rather than expand passively.

### 3. Final Placement (10 points)

This is based on elimination order.

- Teams that are eliminated earlier place lower.
- If multiple teams are still alive when the game ends, those surviving teams are ordered by their **current tile count at game end** (higher tiles = better placement).

Only the top 5 teams receive placement points.

---

## Point Tables

**Max Tiles (Top 10)**

| Rank | Points |
| ---- | ------ |
| 1st  | 60     |
| 2nd  | 54     |
| 3rd  | 48     |
| 4th  | 42     |
| 5th  | 36     |
| 6th  | 30     |
| 7th  | 24     |
| 8th  | 18     |
| 9th  | 12     |
| 10th | 6      |

**Crown Time (Top 10)**

| Rank | Points |
| ---- | ------ |
| 1st  | 30     |
| 2nd  | 27     |
| 3rd  | 24     |
| 4th  | 21     |
| 5th  | 18     |
| 6th  | 15     |
| 7th  | 12     |
| 8th  | 9      |
| 9th  | 6      |
| 10th | 3      |

**Final Placement (Top 5)**

| Rank | Points |
| ---- | ------ |
| 1st  | 10     |
| 2nd  | 8      |
| 3rd  | 6      |
| 4th  | 4      |
| 5th  | 2      |

---

## Tie-Breaking

If two or more teams have the same value in a category (e.g., identical peak tile percentage), they share the better rank and both receive the same points. The next rank is skipped.

**Example:** If two teams tie for 1st in Crown Time, both receive 30 points. The next team gets 3rd place (24 points), not 2nd.

---

## How the Crown Works

- The crown is assigned to the **team** with the highest total tile count (not individual players).
- Bot team does not count toward competitive crown/score metrics.
- **All members** of the crowned team display the crown icon, making the leading team highly visible.
- The crown updates throughout the match as territory changes hands.
- Crown time only counts during active gameplay (not during spawn phase).

---

## In-Game UI

### During the Match

The **Team Stats panel** has three views you can cycle through:

1. **Control** — Current tile %, gold, max troops
2. **Units** — Launchers, SAMs, warships, cities
3. **Competitive** — Current tile %, peak tile %, crown time

In the current UI, crown time is shown in the **Competitive** view.

### At Match End

When competitive scoring is enabled, the **win screen** displays a score breakdown table showing each team's points in all three categories and their total score.

---

## Example Scenario

A Trios match with 4 teams ends with these results:

| Team   | Peak Tiles | Crown Ratio | Eliminated     |
| ------ | ---------- | ----------- | -------------- |
| Red    | 35%        | 45%         | Winner         |
| Blue   | 28%        | 30%         | 3rd eliminated |
| Teal   | 22%        | 20%         | 2nd eliminated |
| Purple | 18%        | 5%          | 1st eliminated |

**Scoring:**

| Team   | Tiles Pts | Crown Pts | Place Pts | Total   |
| ------ | --------- | --------- | --------- | ------- |
| Red    | 60        | 30        | 10        | **100** |
| Blue   | 54        | 27        | 6         | **87**  |
| Teal   | 48        | 24        | 4         | **76**  |
| Purple | 42        | 21        | 2         | **65**  |

Red dominated all categories. But consider a different scenario where Blue held the crown longer than Red:

| Team   | Peak Tiles | Crown Ratio | Eliminated     |
| ------ | ---------- | ----------- | -------------- |
| Red    | 35%        | 15%         | Winner         |
| Blue   | 28%        | 50%         | 3rd eliminated |
| Teal   | 22%        | 30%         | 2nd eliminated |
| Purple | 18%        | 5%          | 1st eliminated |

| Team   | Tiles Pts | Crown Pts | Place Pts | Total  |
| ------ | --------- | --------- | --------- | ------ |
| Red    | 60        | 24        | 10        | **94** |
| Blue   | 54        | 30        | 6         | **90** |
| Teal   | 48        | 27        | 4         | **79** |
| Purple | 42        | 21        | 2         | **65** |

Here Blue nearly catches Red despite losing the match, because Blue held the crown for much longer. This rewards sustained dominance, not just final snowball.

---

## Why This System?

The old system scored teams only on Max Tiles Owned (peak map control). This meant:

- Early aggression was disproportionately rewarded
- Once a team peaked, the match scoring was effectively decided
- There was no incentive to contest the crown or coordinate attacks on the leading team
- Comebacks were strategically meaningless

The multi-metric system fixes this by making three different skills matter:

- **Max Tiles** rewards macro expansion and map control
- **Crown Time** rewards sustained dominance and encourages teams to contest the leader
- **Final Placement** rewards survival and makes late-game play meaningful
