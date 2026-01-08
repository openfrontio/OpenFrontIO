import compression from "compression";
import express, { Request, Response } from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  clearCache as clearMapCache,
  getMapMetadata,
  listMaps,
  setConfig,
} from "./api/maps.js";
import {
  clearAdapterCaches,
  computePath,
  computePfMiniPath,
} from "./api/pathfinding.js";

// Parse command-line arguments
const args = process.argv.slice(2);
const noCache = args.includes("--no-cache");

// Configure map loading
if (noCache) {
  setConfig({ cachePaths: false });
  console.log("Path caching disabled (--no-cache)");
}

const app = express();
const PORT = process.env.PORT ?? 5555;

// Middleware
app.use(compression()); // gzip compression for large responses
app.use(express.json({ limit: "50mb" })); // JSON body parser with larger limit

// Serve static files from public directory
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
app.use(express.static(publicDir));

// API Routes

/**
 * GET /api/maps
 * List all available maps
 */
app.get("/api/maps", (req: Request, res: Response) => {
  try {
    const maps = listMaps();
    res.json({ maps });
  } catch (error) {
    console.error("Error listing maps:", error);
    res.status(500).json({
      error: "Failed to list maps",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/maps/:name
 * Get map metadata (map data, dimensions)
 */
app.get("/api/maps/:name", async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const metadata = await getMapMetadata(name);
    res.json(metadata);
  } catch (error) {
    console.error(`Error loading map ${req.params.name}:`, error);

    if (error instanceof Error && error.message.includes("ENOENT")) {
      res.status(404).json({
        error: "Map not found",
        message: `Map "${req.params.name}" does not exist`,
      });
    } else {
      res.status(500).json({
        error: "Failed to load map",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

/**
 * GET /api/maps/:name/thumbnail
 * Get map thumbnail image
 */
app.get("/api/maps/:name/thumbnail", (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const thumbnailPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../resources/maps",
      name,
      "thumbnail.webp",
    );
    res.sendFile(thumbnailPath);
  } catch (error) {
    console.error(`Error loading thumbnail for ${req.params.name}:`, error);
    res.status(404).json({
      error: "Thumbnail not found",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/pathfind
 * Compute pathfinding between two points
 *
 * Request body:
 * {
 *   map: string,
 *   from: [x, y],
 *   to: [x, y],
 *   includePfMini?: boolean
 * }
 */
app.post("/api/pathfind", async (req: Request, res: Response) => {
  try {
    const { map, from, to, includePfMini } = req.body;

    // Validate request
    if (!map || !from || !to) {
      return res.status(400).json({
        error: "Invalid request",
        message: "Missing required fields: map, from, to",
      });
    }

    if (
      !Array.isArray(from) ||
      from.length !== 2 ||
      !Array.isArray(to) ||
      to.length !== 2
    ) {
      return res.status(400).json({
        error: "Invalid coordinates",
        message: "from and to must be [x, y] coordinate arrays",
      });
    }

    // Compute paths
    const result = await computePath(
      map,
      from as [number, number],
      to as [number, number],
      { includePfMini: !!includePfMini },
    );

    res.json(result);
  } catch (error) {
    console.error("Error computing path:", error);

    if (error instanceof Error && error.message.includes("is not water")) {
      res.status(400).json({
        error: "Invalid coordinates",
        message: error.message,
      });
    } else {
      res.status(500).json({
        error: "Failed to compute path",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

/**
 * POST /api/pathfind-pfmini
 * Compute only PathFinder.Mini path
 *
 * Request body:
 * {
 *   map: string,
 *   from: [x, y],
 *   to: [x, y]
 * }
 */
app.post("/api/pathfind-pfmini", async (req: Request, res: Response) => {
  try {
    const { map, from, to } = req.body;

    // Validate request
    if (!map || !from || !to) {
      return res.status(400).json({
        error: "Invalid request",
        message: "Missing required fields: map, from, to",
      });
    }

    if (
      !Array.isArray(from) ||
      from.length !== 2 ||
      !Array.isArray(to) ||
      to.length !== 2
    ) {
      return res.status(400).json({
        error: "Invalid coordinates",
        message: "from and to must be [x, y] coordinate arrays",
      });
    }

    // Compute PF.Mini path only
    const result = await computePfMiniPath(
      map,
      from as [number, number],
      to as [number, number],
    );

    res.json(result);
  } catch (error) {
    console.error("Error computing PF.Mini path:", error);

    if (error instanceof Error && error.message.includes("is not water")) {
      res.status(400).json({
        error: "Invalid coordinates",
        message: error.message,
      });
    } else {
      res.status(500).json({
        error: "Failed to compute PF.Mini path",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

/**
 * POST /api/cache/clear
 * Clear all caches (useful for development)
 */
app.post("/api/cache/clear", (req: Request, res: Response) => {
  try {
    clearMapCache();
    clearAdapterCaches();
    res.json({ message: "Caches cleared successfully" });
  } catch (error) {
    console.error("Error clearing caches:", error);
    res.status(500).json({
      error: "Failed to clear caches",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Pathfinding Playground Server                            ║
╚════════════════════════════════════════════════════════════╝

Server running at: http://localhost:${PORT}

Configuration:
  - Path caching: ${noCache ? "disabled" : "enabled"}

Press Ctrl+C to stop
  `);
});
