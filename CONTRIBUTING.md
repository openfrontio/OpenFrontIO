# Contributing to OpenFront.io

First off, thank you for considering contributing to OpenFront.io! It's people like you that make OpenFront such a great game.

We welcome contributions from everyone. By participating in this project, you agree to abide by our code of conduct and treat all community members with respect.

## Quick Links

- **Game**: [https://openfront.io/](https://openfront.io/)
- **Discord**: [Join the Development Discord](https://discord.gg/K9zernJB5z)
- **Translations**: [Crowdin Project](https://crowdin.com/project/openfront-mls)
- **Issues**: [GitHub Issues](https://github.com/openfrontio/OpenFrontIO/issues)

## Project Governance

- The project maintainer ([evan](https://github.com/evanpelle)) has final authority on all code changes and design decisions.
- All pull requests require maintainer approval before merging.
- The maintainer reserves the right to reject contributions that don't align with the project's vision or quality standards.

## Contribution Path for New Contributors

To ensure code quality and project stability, we use a progressive contribution system:

1. **New Contributors**: Limited to UI improvements and small bug fixes only.
   - This helps you become familiar with the codebase.
   - UI changes are easier to review and less likely to break core functionality.
   - Small, focused PRs have a higher chance of being accepted.
2. **Established Contributors**: After several successful PRs and demonstrating understanding of the codebase, you may work on more complex features.
3. **Core Contributors**: Only those with extensive experience with the project may modify critical game systems.

## Finding Something to Work On

Before writing any code:

1. Request to join the development [Discord](https://discord.gg/K9zernJB5z).
2. Find an issue labelled [`approved`](https://github.com/openfrontio/OpenFrontIO/issues?q=is%3Aissue%20state%3Aopen%20label%3Aapproved), or open a new issue and wait for it to be labelled `approved`.
3. Comment on the issue asking to be assigned.
4. Wait to be assigned before investing significant time.

### PRs Without an Approved Issue

Pull requests that do not link to an issue labelled `approved` will be **automatically closed**. The only exception is small bug fixes, which may be submitted directly without a pre-approved issue.

If your PR is closed for this reason, open an issue describing the change, wait for it to be labelled `approved`, comment asking to be assigned, and then resubmit once you've been assigned.

### AI-Generated PRs

Pull requests that appear to be AI-generated without genuine author understanding will be **closed**.

Using AI tools is fine — but you **MUST** understand the code you are submitting and be able to explain why each decision was made. If you cannot defend the design choices, justify the approach, or answer questions about how the code works in review, the PR will be closed.

## Getting Started

### Prerequisites

- **Node.js**: A recent version.
- **npm**: Version 10.9.2 or higher.
- **Git**: For version control.

### Installation

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenFrontIO.git
   cd OpenFrontIO
   ```
3. **Install dependencies**:
   > **Important**: Use `npm run inst` instead of `npm install`. This runs `npm ci --ignore-scripts` to ensure a consistent and secure environment.
   ```bash
   npm run inst
   ```

### Running the Game

- **Full Development Mode** (Client + Server):
  ```bash
  npm run dev
  ```
  This starts the dev server and the game server, and opens your browser.
- **Client Only**:
  ```bash
  npm run start:client
  ```
- **Server Only**:
  ```bash
  npm run start:server-dev
  ```

## Development Workflow

### Branching

Create a new branch for each feature or bug fix:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-number-bug-name
```

### Coding Standards

We enforce code quality using ESLint and Prettier. All code must follow existing style patterns, and new features should not break existing functionality.

- **Format Code**: `npm run format`
- **Lint Code**: `npm run lint`
- **Lint & Fix**: `npm run lint:fix`

### Testing

All new features and bug fixes should include relevant tests. We use **Vitest**.

- **Run Tests**: `npm test`
- **Run Coverage**: `npm run test:coverage`

**Note**: All code changes in `src/core` **MUST** be tested to ensure game logic stability.

## Submitting a Pull Request

1. **Commit your changes** with a clear, present-tense message ("Add feature", not "Added feature"):
   ```bash
   git commit -m "Add new map rendering logic"
   ```
2. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
3. **Open a Pull Request** against the original repository:
   - Fill out the **PR Template** completely.
   - Link the approved issue (e.g., `Resolves #123`).
   - Keep PRs focused on a single feature or bug fix.
   - Include screenshots for UI changes.
   - Describe what testing you've performed.
   - Be responsive to feedback and requested changes.

### PR Checklist

Before submitting, ensure you have:

- [ ] Linked the relevant approved issue (e.g., `Resolves #123`).
- [ ] Added screenshots for any UI changes.
- [ ] Processed text through `translateText()` and added strings to `en.json`.
- [ ] Added/Updated tests in the `tests/` directory.
- [ ] Verified that `npm test` passes.
- [ ] Provided your Discord username in the PR description for communication.

## Communication

- Be respectful and constructive in all project interactions.
- Questions are welcome, but please search existing issues first.
- For major changes, discuss in an issue before starting work.

## Translations

Translators are welcome! We use Crowdin for translations. To help translate OpenFront.io:

1. Join the [Translation Discord](https://discord.gg/3zZzacjWFr).
2. Visit our [Crowdin Project](https://crowdin.com/project/openfront-mls).
3. Sign up or log in, then join the project.
4. Select the language you want to translate. If your language isn't listed, click "Request New Language".
5. Translate the strings.

Feel free to ask questions in the translation Discord server!

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0 (AGPL v3.0)](LICENSE).

## Final Notes

Remember that maintaining this project requires significant effort. The maintainer appreciates your contributions but must prioritize long-term project health and stability. Not all contributions will be accepted, and that's okay.

Thank you for helping make OpenFront better!
