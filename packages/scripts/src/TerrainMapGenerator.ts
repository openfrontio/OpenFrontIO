import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const maps = [
  "Africa",
  "Asia",
  "WorldMap",
  "BlackSea",
  "Europe",
  "Mars",
  "Mena",
  "Oceania",
  "NorthAmerica",
];

const loadTerrainMaps = async () => {
  await Promise.all(maps.map((map) => runWorker(map)));
  process.exit();
};

const runWorker = async (map: string): Promise<void> => {
  console.log(`Starting a worker for ${map}`);
  const worker = new Worker(
    path.resolve(__dirname, "TerrainMapGenerator.worker.js"),
  );
  // send the map name to worker
  worker.postMessage(map);

  // wait for worker to finish
  await new Promise((resolve) => {
    worker.onmessage = (event) => {
      resolve(event.data);
    };
  });
  worker.terminate();
};

if (import.meta.url === `file://${__filename}`) {
  await loadTerrainMaps();
}
