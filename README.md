<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/images/OpenFrontLogoDark.svg">
    <source media="(prefers-color-scheme: light)" srcset="resources/images/OpenFrontLogo.svg">
    <img src="resources/images/OpenFrontLogo.svg" alt="OpenFrontIO Logo" width="300">
  </picture>
</p>

[OpenFront.io](https://openfront.io/) is an online real-time strategy game focused on territorial control and alliance building. Players compete to expand their territory, build structures, and form strategic alliances in various maps based on real-world geography.

This is a fork/rewrite of WarFront.io. Credit to https://github.com/WarFrontIO.

![CI](https://github.com/openfrontio/OpenFrontIO/actions/workflows/ci.yml/badge.svg)
[![Crowdin](https://badges.crowdin.net/openfront-mls/localized.svg)](https://crowdin.com/project/openfront-mls)
[![CLA assistant](https://cla-assistant.io/readme/badge/openfrontio/OpenFrontIO)](https://cla-assistant.io/openfrontio/OpenFrontIO)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Assets: CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## License

OpenFront source code is licensed under the **GNU Affero General Public License v3.0** with additional attribution requirements:

- Any forks or derivative works must display attribution (e.g., "Based on OpenFront", "Derived from OpenFront", "Powered by OpenFront", or "Fork of OpenFront") prominently on the main menu and/or initial title screen.

See the `ADDITIONAL TERMS` section in [LICENSE](LICENSE) for complete requirements.

For asset licensing, see [LICENSE-ASSETS](LICENSE-ASSETS).  
For license history, see [LICENSING.md](LICENSING.md).

## 🌟 Features

- **Real-time Strategy Gameplay**: Expand your territory and engage in strategic battles
- **Alliance System**: Form alliances with other players for mutual defense
- **Multiple Maps**: Play across various geographical regions including Europe, Asia, Africa, and more
- **Resource Management**: Balance your expansion with defensive capabilities
- **Cross-platform**: Play in any modern web browser

## 📋 Prerequisites

- [npm](https://www.npmjs.com/) (v10.9.2 or higher)
- A modern web browser (Chrome, Firefox, Edge, etc.)

## 🚀 Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/openfrontio/OpenFrontIO.git
   cd OpenFrontIO
   ```

2. **Install dependencies**

   ```bash
   npm i
   ```

## 🎮 Running the Game

### Development Mode

Run both the client and server in development mode with live reloading:

```bash
npm run dev
```

This will:

- Start the webpack dev server for the client
- Launch the game server with development settings
- Open the game in your default browser

### Client Only

To run just the client with hot reloading:

```bash
npm run start:client
```

### Server Only

To run just the server with development settings:

```bash
npm run start:server-dev
```

### Connecting to staging or production backends

Sometimes it's useful to connect to production servers when replaying a game, testing user profiles, purchases, or login flow.

To connect to staging api servers:

```bash
npm run dev:staging
```

To connect to production api servers:

```bash
npm run dev:prod
```

## 🛠️ Development Tools

- **Format code**:

  ```bash
  npm run format
  ```

- **Lint code**:

  ```bash
  npm run lint
  ```

- **Lint and fix code**:

  ```bash
  npm run lint:fix
  ```

- **Testing**
  ```bash
  npm test
  ```

## 🏗️ Project Structure

- `/src/client` - Frontend game client
- `/src/core` - Shared game logic
- `/src/server` - Backend game server
- `/resources` - Static assets (images, maps, etc.)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Request to join the development [Discord](https://discord.gg/K9zernJB5z).
1. Fork the repository
1. Create your feature branch (`git checkout -b amazing-feature`)
1. Commit your changes (`git commit -m 'Add some amazing feature'`)
1. Push to the branch (`git push origin amazing-feature`)
1. Open a Pull Request

## 🌐 Translation

Translators are welcome! Please feel free to help translate into your language.
How to help?

1. Request to join the dev [Discord](https://discord.gg/K9zernJB5z) (in the application form, say you want to help translate)
1. Go to the project's Crowdin translation page: [https://crowdin.com/project/openfront-mls](https://crowdin.com/project/openfront-mls)
1. Login if you already have an account/ Sign up if you don't have one
1. Select the language you want to translate in/ If your language isn't on the list, click the "Request New Language" button and enter the language you want added there.
1. Translate the strings

### Project Governance

- The project maintainer ([evan](https://github.com/evanpelle)) has final authority on all code changes and design decisions
- All pull requests require maintainer approval before merging
- The maintainer reserves the right to reject contributions that don't align with the project's vision or quality standards

### Contribution Path for New Contributors

To ensure code quality and project stability, we use a progressive contribution system:

1. **New Contributors**: Limited to UI improvements and small bug fixes only

   - This helps you become familiar with the codebase
   - UI changes are easier to review and less likely to break core functionality
   - Small, focused PRs have a higher chance of being accepted

2. **Established Contributors**: After several successful PRs and demonstrating understanding of the codebase, you may work on more complex features

3. **Core Contributors**: Only those with extensive experience with the project may modify critical game systems

### How to Contribute Successfully

1. **Before Starting Work**:

   - Open an issue describing what you want to contribute
   - Wait for maintainer feedback before investing significant time
   - Small improvements can proceed directly to PR stage

2. **Code Quality Requirements**:

   - All code must be well-commented and follow existing style patterns
   - New features should not break existing functionality
   - Code should be thoroughly tested before submission
   - All code changes in src/core _MUST_ be tested.

3. **Pull Request Process**:

   - Keep PRs focused on a single feature or bug fix
   - Include screenshots for UI changes
   - Describe what testing you've performed
   - Be responsive to feedback and requested changes

4. **Testing Requirements**:
   - Verify your changes work as expected
   - Test on multiple systems/browsers if applicable
   - Document your testing process in the PR

### Communication

- Be respectful and constructive in all project interactions
- Questions are welcome, but please search existing issues first
- For major changes, discuss in an issue before starting work

### Final Notes

Remember that maintaining this project requires significant effort. The maintainer appreciates your contributions but must prioritize long-term project health and stability. Not all contributions will be accepted, and that's okay.

Thank you for helping make OpenFront better!
