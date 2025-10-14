# License for OpenFront.io Project

## Overview

This document provides comprehensive licensing information for the OpenFront.io project, including its evolution from MIT to GPL to AGPL licensing, asset licensing terms, and proprietary content notices.

## Timeline

### Phase 1: MIT Only

- **Commits:** Initial commit through commit before 25d5cc370207fd39e0c3bcaa69873b8fc6c60e68
- **Date Range:** 2024 - March 25, 2025
- **License:** MIT License only
- **Applies to:** Entire project
- **Copyright Holders:** WarFront.io Team, OpenFront LLC (and contributors)
- **Note:** OpenFront.io extensively modified/replaced almost all original code

### Phase 2: Mixed MIT/GPL

- **Starting Commit:** 25d5cc370207fd39e0c3bcaa69873b8fc6c60e68
- **Date:** March 25, 2025
- **Licenses:**
  - GPL v3.0 for `src/client` directory
  - MIT for all other directories
- **Copyright Holders:** OpenFront LLC (and contributors)
- **Note:** Created split licensing structure with copyleft for client code

### Phase 3: AGPL + Creative Commons

- **Starting After:** 9d5c108b83937a30ab42de6b1dca5a64e577aaac
- **Date:** September 4, 2025
- **Licenses:**
  - **Code:** Licensed under AGPL v3.0 (entire codebase)
  - **Assets:** Creative Commons BY-SA 4.0 (all non-code assets)
- **Copyright Holders:** OpenFront LLC (and contributors)
- **Changes:**
  - Unified licensing approach (no more directory-specific licenses)
  - Upgraded from GPL v3 to AGPL v3 for stronger network copyleft
  - Added Creative Commons BY-SA 4.0 for all assets
  - All new code is AGPL v3.0 only

### Phase 4: Mixed Asset Licensing

- **Starting After:** c2cf2ce65f74ac91859f68a84aec89aeda5722ee
- **Date:** September 28, 2025
- **Licenses:**
  - **Code:** AGPL v3.0 (unchanged from Phase 3)
  - **Open Assets (/resources):** Creative Commons BY-SA 4.0 (unchanged from Phase 3)
  - **Proprietary Assets (/proprietary):** All Rights Reserved
- **Copyright Holders:** OpenFront LLC and Contributors
- **Changes:**
  - Added `/proprietary` directory for copyrighted assets
  - Established dual-track asset licensing structure
  - Open assets in `/resources` remain CC BY-SA 4.0
  - Proprietary assets override open assets during build process
  - Contributors retain copyright while granting usage rights to OpenFront LLC

### Phase 5: AGPL with Additional Attribution Terms

- **Starting After:** 136cfa1316dd584bece48f7ad9f8f17e8603f1c7
- **Date:** October 12, 2025
- **Changes:**
  - Added Section 7 attribution requirement to AGPL v3.0
  - All forks must display "Based on OpenFront" (or similar) on main menu
  - Make clear that "OpenFront" is a registered trademark

### Phase 6: Clarified AGPL Additional Attribution Terms

- **Starting After:** e7497bfb767c4bf3e1e00eac0a13de995419f8b5
- **Date:** October 14, 2025
- **Changes:**
  - Added additional Section 7 attribution requirements to the LICENSE
  - Removed trademark notice from LICENSE file as it's unnecessary

## Important Notes

### For Code:

- All code prior to September 4, 2025 remains available under its original license (MIT or GPL as applicable from historical commits)
- New code contributions from September 4, 2025 forward are licensed under AGPL v3 only
- Forks and derivative works MUST comply with AGPL v3 terms
- Historical MIT-licensed code remains available under MIT from previous commits

### Legal Considerations:

- The AGPL's network copyleft provisions are stronger than GPL v3
- When combining code, the most restrictive compatible license applies to the combined work
- Consult legal counsel for specific compliance questions

# Asset Licensing

## Repository Assets

All assets included in this repository (graphics, sounds, music, models) are licensed under Creative Commons BY-SA 4.0.

## External/Proprietary Assets

**The following assets are NOT included in the open source license:**

- Assets hosted on our CDN/servers
- Assets stored in our database
- Premium skins, models, and textures
- Sound effects and music accessed via API
- Any assets not explicitly included in this repository
- Any asset in the proprietary/ folder

These external assets are:

- Copyright © 2024-2025 OpenFront LLC
- All Rights Reserved
- NOT licensed for use, modification, or redistribution
- Proprietary and may not be extracted, copied, or used outside of the official OpenFront.io service

## Important Legal Notice

Accessing, downloading, extracting, or using proprietary assets from our servers/database without explicit written permission is prohibited and may violate copyright law.

The open source license (AGPL) applies ONLY to code. The CC BY-SA license applies ONLY to assets included in this repository. All other assets remain proprietary.

## Contributing

See CONTRIBUTING.md for current licensing requirements. All code contributions are licensed under AGPL v3 and assets under CC BY-SA 4.0.

For questions, contact OpenFront LLC.

## Historical MIT License

Portions Copyright (c) 2024 WarFront.io Team
Portions Copyright (c) 2024-2025 OpenFront LLC (and contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
