# Development reference

If you would like to contribute, first, check out the [contribution page](contribute.md), and then check out the [Getting Started guide](getting_started.md) to learn how to set up a local copy of the repository.

## Introduction

This project started as a fork of WarFront (not to be confused with FrontWars), by evanpelle. It is written in TypeScript, which is like JavaScript, but with static typing. As of writing, the project is deployed as a website at openfront.io, with a planned release on Steam.

## Project Structure

- `/docs` - The documentation you're reading right now!
- `/resources` - Static assets (images, maps, etc.)
- `/proprietary` - Non free static assets (music)
- `/map-generator` - A tool used to create maps for the game
- `/tests` - [Jest](https://jestjs.io/) tests for [regression](https://en.wikipedia.org/wiki/Regression_testing) prevention
- `/src` - The source code
  - `./core` - [Shared game logic](core.md)
    - `./game` - Files managing in-memory game state, map loading, and utilities for game management
    - `./configuration` - Different presets to be used by other parts of the code
    - `./execution` - Logic controllers for different parts of the game
    - `./worker` - Isolation of long-running or async tasks to a worker context
    - `./pathfinding` - Different algorithms for navigation
    - `./validations` - Utilities for sanitizing user content (like usernames)
    - `./utilities` - Generic core helper functions
  - `./client` - [Frontend game client](client.md)
    - `./graphics` - 2D rendering
    - `./components` - Custom HTML components
    - `./styles` - CSS used by the client
    - `./data` - json data accessed by the client (like countries)
    - `./sound` - Sound management
    - `./utilities` - Generic client helper functions
  - `./server` - [Backend game server](server.md)

## Technologies used

- [Lit](https://lit.dev/) for creating usable html objects (usually `TemplateResult`) from strings.

![](./res/sample.png)
