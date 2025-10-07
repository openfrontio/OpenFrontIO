# OpenFrontIO Project Structure

This document outlines the architecture of the OpenFrontIO project(which took a bit longer than expected)

OpenFrontIO/
├── .dockerignore # Specifies files to be ignored by Docker
├── .editorconfig # Defines coding styles for different editors
├── .gitignore # Specifies files to be ignored by Git
├── .gitmodules # Defines submodules used in the project
├── .github/ # GitHub-specific files (workflows, issue templates, PR templates)
├── .husky/ # Git hooks configuration (e.g., pre-commit checks)
├── .prettierrc # Configuration file for Prettier code formatter
├── .swcrc # Configuration file for SWC (Speedy Web Compiler)
├── .vscode/ # VS Code editor-specific settings (e.g., launch configurations)
├── **mocks**/ # Mocks for Jest tests (e.g., for file assets)
├── build-deploy.sh # A shell script to build and deploy the project
├── build.sh # A shell script to build the project
├── CODEOWNERS # Specifies individuals or teams that are responsible for code in a repository
├── deploy.sh # A shell script to deploy the project
├── Dockerfile # A script to create a Docker image
├── eslint.config.js # Configuration file for ESLint
├── example.env # Example environment file
├── jest.config.ts # Configuration file for Jest testing framework
├── LICENSE # The main license file for the project
├── LICENSE-ASSETS # License file for assets
├── LICENSING.md # A document explaining the licensing of the project and its dependencies
├── nginx.conf # Configuration file for Nginx web server
├── package-lock.json # Records the exact version of each installed package
├── package.json # Defines project metadata, dependencies, and npm scripts
├── postcss.config.js # Configuration file for PostCSS
├── README.md # The main README file for the project
├── setup.sh # A shell script for setting up the project
├── startup.sh # A shell script to start the project
├── STRUCTURE.md # This file, documenting the project structure
├── supervisord.conf # Configuration file for Supervisord process manager
├── tailwind.config.js # Configuration file for Tailwind CSS
├── tsconfig.jest.json # TypeScript configuration for Jest
├── tsconfig.json # TypeScript compiler configuration for the project
├── update.sh # A shell script to update the project
├── webpack.config.js # Configuration for Webpack, which bundles the client-side code for the browser
├── src/ # Main source code directory
│ ├── client/ # Contains all frontend/client-side code that runs in the browser
│ │ ├── Main.ts # Main entry point; initializes UI, handles auth, manages modals
│ │ ├── ClientGameRunner.ts # Manages client-side game loop and server communication
│ │ ├── Transport.ts # Handles WebSocket communication
│ │ ├── InputHandler.ts # Captures and processes user input
│ │ ├── graphics/ # Rendering logic using Pixi.js
│ │ │ └── GameRenderer.ts # Core rendering class for the game state
│ │ └── components/ # Reusable UI components built with Lit (modals, buttons, inputs)
│ ├── server/ # Contains all backend/server-side code for Node.js
│ │ ├── Server.ts # Main server entry point; manages cluster and networking
│ │ ├── Master.ts # Master process logic; manages workers and public lobbies
│ │ ├── Worker.ts # Worker process logic; hosts GameServer instances
│ │ └── GameServer.ts # Manages a single game instance and connected clients
│ └── core/ # Isomorphic code shared between client and server
│ ├── game/ # Fundamental game logic and rules
│ │ ├── GameImpl.ts # Concrete implementation of game state and mechanics
│ │ ├── Game.ts # Primary interfaces for core game components
│ │ └── GameView.ts # Client-side, read-only representation of game state
│ ├── Schemas.ts # Data structures and validation schemas (Zod)
│ └── pathfinding/ # Pathfinding algorithms (like A\*) for unit movement
├── tests/ # Unit and integration tests (Jest)
├── resources/ # Source for static game assets (images, sounds, fonts, maps)
├── static/ # Publicly served static assets, often copied from resources/
├── proprietary/ # Proprietary assets with specific licensing
└── map-generator/ # Separate Go program to generate game maps
