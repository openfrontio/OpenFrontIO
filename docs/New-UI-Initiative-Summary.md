<!-- DO NOT COMMIT THIS FILE -->
# OpenFrontIO New In-Game UI Initiative

Based on the Discord thread and recent pull requests, there is a coordinated effort to overhaul the in-game user interface for OpenFrontIO. This document summarizes the general desires, goals, and progress of this initiative.

## Core Objective

The primary goal is to implement a "New In Game UI" based on a specific Figma mockup (referenced in Issue #2260). The overarching theme is to modernize the interface, improve usability (especially on mobile), and organize information more logically.

## Key Themes and Desires

1.  **Polished Aesthetics:**
    *   There's a focus on visual consistency, such as ensuring "pixels at the sides and bottom/top of the panels is the same now" to make it feel "even more polished."
    *   Adjustments to colors (e.g., "The blue shade might still be wrong") indicate a desire for precise adherence to the new design language.
    *   **Code Practice:** UI elements should mirror existing components (like `AttacksDisplay`) in terms of background, border radius (e.g., `rounded-lg`), and overall styling to maintain consistency.
    *   **Screen Padding:** Maintain fixed, consistent padding from screen edges across all UI panels.

2.  **Improved Information Architecture & Screen Real Estate:**
    *   **Mobile Optimization:** A significant driver is saving screen space on mobile devices. The current UI takes up "so much of mobile screen space."
    *   **Collapsible/Contextual Panels:** There's a strong desire for panels (like player info) to be collapsible or only appear contextually (e.g., on mouseover of a territory) to avoid cluttering the screen when not needed.
    *   **Conflict Resolution:** The team is actively working through UX conflicts, such as ensuring the player info panel doesn't interfere with build menu tooltips ("You can’t hover a build menu item and a player territory simultaneously").

3.  **Specific Component Updates:**
    *   **Player Info Panel:** Moving this panel is deemed "necessary when the alliance info is added." The behavior of this panel is being refined (e.g., sticking open on mobile taps, staying open on desktop when hovering the map under the overview).
    *   **Right Sidebar:** The `gameRightSidebar` is being redesigned (PR #2576, #2577, #2790) to match the Figma mockup, focusing initially on the top bar.
    *   **Alliance Events:** Actionable alliance events (requests, renewals) are being separated from the general scrolling event feed and "pinned" to ensure they aren't missed (PR #3178).
        *   **Code Practice:** Actionable items (with buttons) are moved to dedicated components (e.g., `AllianceDisplay`), while non-actionable informational notifications remain in the general `EventsDisplay`.

4.  **Modular Implementation & Code Practices:**
    *   The team recognizes the complexity of the overhaul and is intentionally splitting the work into smaller, manageable PRs ("it can be split in 3 big changes").
    *   **Component Separation:** There is a strong push to move specific UI sections into their own dedicated components (e.g., pulling alliance UI out of the general event feed into `AllianceDisplay.ts`).
    *   **HTML/CSS over TS:** Positioning and layout should be handled with HTML and Tailwind CSS (e.g., "fully seperate element with tailwind is the way to go") rather than complex TypeScript logic whenever possible.
    *   **Responsive Wrappers:** Use Tailwind flex and grid layouts (e.g., `flex-col`) to stack UI elements (like sidebars and replay controls) vertically to save screen space.
    *   **Visibility Toggling:** Use direct DOM manipulation with Tailwind classes (e.g., `classList.add("hidden")`) to hide elements during game transitions, rather than relying on component-specific APIs.
    *   **Tailwind v4 Migration:** Be aware of Tailwind v4 updates. For example, `backdrop-blur-sm` in v3 maps to `backdrop-blur-xs` in v4, and `blur-sm` maps to `blur-xs`. Update HTML templates accordingly.
    *   **DRY Principles:** Reviewers actively push back against duplicated rendering logic (e.g., copying attack rendering from `AttacksDisplay` to `EventsDisplay`), encouraging shared helpers or mixins.
    *   **Performance:** Reviewers flag unnecessary rendering overhead, such as unconditional `requestUpdate()` calls on every tick, preferring reactive state updates.
    *   **State Management & User Interaction:** When a user is interacting with a popup or panel (e.g., hovering), defer or queue state updates (like removing expired indicators) to prevent jarring UI changes while the user is reading or clicking.
    *   **Null Safety:** Use explicit guards and type narrowing (e.g., discriminated unions) rather than non-null assertions (`!`) when dealing with optional fields in UI state objects.

## Current Status & Next Steps

*   **In Progress/Merged:** Parts of the right sidebar redesign have been merged. The pinning of alliance events is currently under review (PR #3178) and is being refined to better match the styling of other panels.
*   **Pending:** Further implementation of the Figma design, resolving the player info hover/collapse mechanics, and potentially relocating attack messages.
*   **Coordination:** The team is actively communicating on Discord and GitHub to align efforts, share inspiration, and ensure new components adhere to the desired HTML/Tailwind structure.

## Summary

The community desires a cleaner, more responsive, and less intrusive in-game UI that closely follows the new Figma designs. The approach is collaborative and iterative, focusing on solving specific UX pain points (like missed alliance requests or cluttered mobile screens) while gradually migrating the entire interface to the new standard, emphasizing component separation and CSS-driven layouts.
