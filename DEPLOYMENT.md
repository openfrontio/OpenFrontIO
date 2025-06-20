# Deployment Scripts

This directory contains deployment scripts that have been split into separate build and deploy operations for better flexibility and control.

## Scripts Overview

### `build.sh`

- **Purpose**: Builds and uploads Docker image to Docker Hub
- **Usage**: `./build.sh [prod|staging] [version_tag]`
- **Parameters**:
  - `environment`: prod or staging
  - `version_tag`: Docker image version tag (required)

### `deploy.sh`

- **Purpose**: Deploys the built image to Hetzner server
- **Usage**: `./deploy.sh [prod|staging] [eu|nbg1|staging|masters] [version_tag] [subdomain] [--enable_basic_auth]`
- **Parameters**:
  - `environment`: prod or staging
  - `host`: eu, nbg1, staging, or masters
  - `version_tag`: Docker image version tag (required)
  - `subdomain`: Optional custom subdomain
  - `--enable_basic_auth`: Optional flag to enable basic authentication

### `build-deploy.sh`

- **Purpose**: Wrapper script that runs both build and deploy in sequence
- **Usage**: `./build-deploy.sh [prod|staging] [eu|nbg1|staging|masters] [subdomain] [--enable_basic_auth]`
- **Note**: Maintains backward compatibility with the original script, automatically generates version tag

## Usage Examples

### Option 1: Build and Deploy Separately

```bash
# Step 1: Build the Docker image with a specific version tag
./build.sh prod v1.2.3

# Step 2: Deploy the same version to server
./deploy.sh prod eu v1.2.3

# Or deploy with basic auth enabled
./deploy.sh prod eu v1.2.3 --enable_basic_auth

# With custom subdomain
./deploy.sh prod eu v1.2.3 mysubdomain --enable_basic_auth
```

### Option 2: Build and Deploy in One Command

```bash
# Build and deploy in sequence (same as original behavior)
./build-deploy.sh prod eu

# With basic auth enabled
./build-deploy.sh prod eu --enable_basic_auth

# With custom subdomain
./build-deploy.sh prod eu mysubdomain --enable_basic_auth
```

## Version Tag Management

- **Explicit Control**: Version tags are passed as parameters to both scripts
- **Consistency**: The wrapper script generates one version tag and passes it to both build and deploy
- **Flexibility**: You can reuse the same version tag for multiple deployments or create new ones as needed
- **Auto-generation**: The wrapper script (`build-deploy.sh`) automatically generates version tags using timestamp format: `YYYYMMDD-HHMMSS`

## Benefits of Separation

1. **Flexibility**: You can build once and deploy multiple times with the same version
2. **Debugging**: Easier to isolate issues between build and deploy phases
3. **CI/CD Integration**: Can integrate build and deploy into separate pipeline stages
4. **Testing**: Can test builds without deploying, or deploy existing builds
5. **Version Control**: Explicit version tag management for better traceability
6. **Simplified Build**: Build script only needs environment and version tag, not deployment-specific parameters

## Environment Variables

Both scripts require the same environment variables as the original script:

- `.env` - Common configuration
- `.env.prod` or `.env.staging` - Environment-specific configuration
- Required variables: `DOCKER_USERNAME`, `DOCKER_REPO`, `SSH_KEY`, etc.

## Error Handling

- If `build.sh` fails, the process stops before deployment
- Both scripts validate all required parameters before proceeding
- Both scripts use `set -e` to exit on any error
- Version tag consistency is enforced by passing the same tag to both scripts
