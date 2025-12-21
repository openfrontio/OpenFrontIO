package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"

	"github.com/chai2010/webp"
)

// The smallest a body of land or lake can be, all smaller are removed
const (
	minIslandSize = 30
	minLakeSize   = 200
)

// Holds raw RGBA image data for the thumbnail
type ThumbData struct {
	Data   []byte
	Width  int
	Height int
}

// XY coord, origin top left, x extending right, y extends down
type Coord struct {
	X, Y int
}

// TerrainType represents the classification of a map tile (e.g., Land or Water).
type TerrainType int

// Enumeration of possible TerrainType values.
const (
	Land TerrainType = iota
	Water
)

// Terrain represents the properties of a single map tile.
// Magnitude represents elevation for Land (0-30) or distance to land for Water.
type Terrain struct {
	Type      TerrainType
	Shoreline bool
	Magnitude float64
	Ocean     bool
}

// MapResult is the output format from the GenerateMap workflow
type MapResult struct {
	Thumbnail []byte
	Map       MapInfo
	Map4x     MapInfo
	Map16x    MapInfo
}

// MapInfo contains the serialized map data and metadata for a specific scale.
type MapInfo struct {
	Data         []byte // packed map data
	Width        int
	Height       int
	NumLandTiles int
}

// GeneratorArgs defines the input parameters for the map generation process.
type GeneratorArgs struct {
	Name        string
	ImageBuffer []byte
	RemoveSmall bool
}

// GenerateMap is the main map-generator workflow.
//   - Maps each pixel to a Terrain type based on its blue value
//   - Removes small islands and lakes
//   - Creates a WebP thumbnail
//   - Packs the map data into binary format for full scale, 1/4 tile count (half dimensions), and 1/16 tile count (quarter dimensions)
//
// Red/green pixel values have no impact, only blue values are used
// For Land tiles, "Magnitude" is determined by `(Blue - 140) / 2“.
// For Water tiles, "Magnitude" is calculated during generation as the distance to the nearest land.
//
// Pixel -> Terrain & Magnitude mapping
// | Input Condition    | Terrain Type    | Magnitude          | Notes                            |
// | :----------------- | :-------------- | :----------------- | :------------------------------- |
// | **Alpha < 20**     | Water           | Distance to Land\* | Transparent pixels become water. |
// | **Blue = 106**     | Water           | Distance to Land\* | Specific key color for water.    |
// | **Blue < 140**     | Land (Plains)   | 0                  | Clamped to minimum magnitude.    |
// | **Blue 140 - 158** | Land (Plains)   | 0 - 9              | 					 					 					 		|
// | **Blue 159 - 178** | Land (Highland) | 10 - 19            | 					 					 					 		|
// | **Blue 179 - 200** | Land (Mountain) | 20 - 30            | 				 					 					 			|
// | **Blue > 200**     | Land (Mountain) | 30                 | Clamped to maximum magnitude.    |
//
// Misc Notes
//   - It normalizes map width/height to multiples of 4 for the mini map downscaling.
func GenerateMap(args GeneratorArgs) (MapResult, error) {
	img, err := png.Decode(bytes.NewReader(args.ImageBuffer))
	if err != nil {
		return MapResult{}, fmt.Errorf("failed to decode PNG: %w", err)
	}

	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()

	// Ensure width and height are multiples of 4 for the mini map downscaling
	width = width - (width % 4)
	height = height - (height % 4)

	log.Printf("Processing Map: %s, dimensions: %dx%d", args.Name, width, height)

	// Initialize terrain grid
	terrain := make([][]Terrain, width)
	for x := range terrain {
		terrain[x] = make([]Terrain, height)
	}

	// Process each pixel
	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			_, _, b, a := img.At(x, y).RGBA()
			// Convert from 16-bit to 8-bit values
			alpha := uint8(a >> 8)
			blue := uint8(b >> 8)

			if alpha < 20 || blue == 106 {
				// Transparent or specific blue value = water
				terrain[x][y] = Terrain{Type: Water}
			} else {
				// Land
				terrain[x][y] = Terrain{Type: Land}

				// Calculate magnitude from blue channel (140-200 range)
				mag := math.Min(200, math.Max(140, float64(blue))) - 140
				terrain[x][y].Magnitude = mag / 2
			}
		}
	}

	removeSmallIslands(terrain, args.RemoveSmall)
	processWater(terrain, args.RemoveSmall)

	terrain4x := createMiniMap(terrain)
	processWater(terrain4x, false)

	terrain16x := createMiniMap(terrain4x)
	processWater(terrain16x, false)

	thumb := createMapThumbnail(terrain4x, 0.5)
	webp, err := convertToWebP(ThumbData{
		Data:   thumb.Pix,
		Width:  thumb.Bounds().Dx(),
		Height: thumb.Bounds().Dy(),
	})
	if err != nil {
		return MapResult{}, fmt.Errorf("failed to save thumbnail: %w", err)
	}

	mapData, mapNumLandTiles := packTerrain(terrain)
	mapData4x, numLandTiles4x := packTerrain(terrain4x)
	mapData16x, numLandTiles16x := packTerrain(terrain16x)

	return MapResult{
		Map: MapInfo{
			Data:         mapData,
			Width:        width,
			Height:       height,
			NumLandTiles: mapNumLandTiles,
		},
		Map4x: MapInfo{
			Data:         mapData4x,
			Width:        width / 2,
			Height:       height / 2,
			NumLandTiles: numLandTiles4x,
		},
		Map16x: MapInfo{
			Data:         mapData16x,
			Width:        width / 4,
			Height:       height / 4,
			NumLandTiles: numLandTiles16x,
		},
		Thumbnail: webp,
	}, nil
}

// convertToWebP encodes raw RGBA thumbnail data into WebP format.
func convertToWebP(thumb ThumbData) ([]byte, error) {
	// Create RGBA image from raw data
	img := image.NewRGBA(image.Rect(0, 0, thumb.Width, thumb.Height))

	// Copy the raw RGBA data
	if len(thumb.Data) != thumb.Width*thumb.Height*4 {
		return nil, fmt.Errorf("invalid thumb data length: expected %d, got %d",
			thumb.Width*thumb.Height*4, len(thumb.Data))
	}

	copy(img.Pix, thumb.Data)

	// Encode as WebP with quality 45 (equivalent to the JavaScript version)
	webpData, err := webp.EncodeRGBA(img, 45)
	if err != nil {
		return nil, fmt.Errorf("failed to encode WebP: %w", err)
	}

	return webpData, nil
}

// createMiniMap downscales the terrain grid by half.
// It maps 2x2 blocks of input tiles to a single output tile.
// The logic prioritizes Water: if any of the 4 source tiles is Water,
// the resulting mini-map tile becomes Water.
func createMiniMap(tm [][]Terrain) [][]Terrain {
	width := len(tm)
	height := len(tm[0])

	miniWidth := width / 2
	miniHeight := height / 2

	miniMap := make([][]Terrain, miniWidth)
	for x := range miniMap {
		miniMap[x] = make([]Terrain, miniHeight)
	}

	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			miniX := x / 2
			miniY := y / 2

			if miniX < miniWidth && miniY < miniHeight {
				// If any of the 4 tiles has water, mini tile is water
				if miniMap[miniX][miniY].Type != Water {
					miniMap[miniX][miniY] = tm[x][y]
				}
			}
		}
	}

	return miniMap
}

// processShore identifies shoreline tiles by checking adjacency.
// It marks Land tiles as shoreline if they neighbor Water, and Water tiles as
// shoreline if they neighbor Land.
// Returns a list of coordinates for all shoreline Water tiles found.
func processShore(terrain [][]Terrain) []Coord {
	log.Println("Identifying shorelines")
	var shorelineWaters []Coord
	width := len(terrain)
	height := len(terrain[0])

	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			tile := &terrain[x][y]
			neighbors := getNeighbors(x, y, terrain)

			if tile.Type == Land {
				// Land tile adjacent to water is shoreline
				for _, n := range neighbors {
					if n.Type == Water {
						tile.Shoreline = true
						break
					}
				}
			} else {
				// Water tile adjacent to land is shoreline
				for _, n := range neighbors {
					if n.Type == Land {
						tile.Shoreline = true
						shorelineWaters = append(shorelineWaters, Coord{X: x, Y: y})
						break
					}
				}
			}
		}
	}

	return shorelineWaters
}

// processDistToLand calculates the distance of water tiles from the nearest land.
// It uses a Breadth-First Search (BFS) starting from the shoreline water tiles.
// The distance is stored in the Magnitude field of the Water tiles.
func processDistToLand(shorelineWaters []Coord, terrain [][]Terrain) {
	log.Println("Setting Water tiles magnitude = Manhattan distance from nearest land")

	width := len(terrain)
	height := len(terrain[0])

	visited := make([][]bool, width)
	for x := range visited {
		visited[x] = make([]bool, height)
	}

	type queueItem struct {
		x, y, dist int
	}

	queue := make([]queueItem, 0)

	// Initialize queue with shoreline waters
	for _, coord := range shorelineWaters {
		queue = append(queue, queueItem{x: coord.X, y: coord.Y, dist: 0})
		visited[coord.X][coord.Y] = true
		terrain[coord.X][coord.Y].Magnitude = 0
	}

	directions := []Coord{{0, 1}, {1, 0}, {0, -1}, {-1, 0}}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		for _, dir := range directions {
			nx := current.x + dir.X
			ny := current.y + dir.Y

			if nx >= 0 && ny >= 0 && nx < width && ny < height &&
				!visited[nx][ny] && terrain[nx][ny].Type == Water {

				visited[nx][ny] = true
				terrain[nx][ny].Magnitude = float64(current.dist + 1)
				queue = append(queue, queueItem{x: nx, y: ny, dist: current.dist + 1})
			}
		}
	}
}

// getNeighbors returns a list of Terrain tiles adjacent to the specified coordinates.
func getNeighbors(x, y int, terrain [][]Terrain) []Terrain {
	coords := getNeighborCoords(x, y, terrain)
	neighbors := make([]Terrain, len(coords))
	for i, coord := range coords {
		neighbors[i] = terrain[coord.X][coord.Y]
	}
	return neighbors
}

// getNeighborCoords returns a list of valid adjacent coordinates (up, down, left, right).
// It ensures that the returned coordinates are within the bounds of the terrain grid.
func getNeighborCoords(x, y int, terrain [][]Terrain) []Coord {
	width := len(terrain)
	height := len(terrain[0])
	var coords []Coord

	if x > 0 {
		coords = append(coords, Coord{X: x - 1, Y: y})
	}
	if x < width-1 {
		coords = append(coords, Coord{X: x + 1, Y: y})
	}
	if y > 0 {
		coords = append(coords, Coord{X: x, Y: y - 1})
	}
	if y < height-1 {
		coords = append(coords, Coord{X: x, Y: y + 1})
	}

	return coords
}

// processWater identifies and processes bodies of water in the terrain.
// It finds all connected water bodies and marks the largest one as Ocean.
// If removeSmall is true, lakes smaller than minLakeSize are converted to Land.
// Finally, it triggers shoreline identification and distance-to-land calculations.
func processWater(terrain [][]Terrain, removeSmall bool) {
	log.Println("Processing water bodies")
	visited := make(map[string]bool)

	type waterBody struct {
		coords []Coord
		size   int
	}

	var waterBodies []waterBody

	// Find all distinct water bodies
	for x := 0; x < len(terrain); x++ {
		for y := 0; y < len(terrain[0]); y++ {
			if terrain[x][y].Type == Water {
				key := fmt.Sprintf("%d,%d", x, y)
				if visited[key] {
					continue
				}

				coords := getArea(x, y, terrain, visited)
				waterBodies = append(waterBodies, waterBody{
					coords: coords,
					size:   len(coords),
				})
			}
		}
	}

	// Sort by size (largest first)
	for i := 0; i < len(waterBodies)-1; i++ {
		for j := i + 1; j < len(waterBodies); j++ {
			if waterBodies[j].size > waterBodies[i].size {
				waterBodies[i], waterBodies[j] = waterBodies[j], waterBodies[i]
			}
		}
	}

	smallLakes := 0

	if len(waterBodies) > 0 {
		// Mark largest water body as ocean
		largestWaterBody := waterBodies[0]
		for _, coord := range largestWaterBody.coords {
			terrain[coord.X][coord.Y].Ocean = true
		}
		log.Printf("Identified ocean with %d water tiles", largestWaterBody.size)

		if removeSmall {
			// Remove small water bodies
			log.Println("Searching for small water bodies for removal")
			for w := 1; w < len(waterBodies); w++ {
				if waterBodies[w].size < minLakeSize {
					smallLakes++
					for _, coord := range waterBodies[w].coords {
						terrain[coord.X][coord.Y].Type = Land
						terrain[coord.X][coord.Y].Magnitude = 0
					}
				}
			}
			log.Printf("Identified and removed %d bodies of water smaller than %d tiles",
				smallLakes, minLakeSize)
		}

		// Process shorelines and distances
		shorelineWaters := processShore(terrain)
		processDistToLand(shorelineWaters, terrain)
	} else {
		log.Println("No water bodies found in the map")
	}
}

// getArea performs a Breadth-First Search (BFS) to find a contiguous area of tiles
// sharing the same TerrainType as the passed x,y coordinates.
// The visited map is updated to prevent reprocessing tiles.
func getArea(x, y int, terrain [][]Terrain, visited map[string]bool) []Coord {
	targetType := terrain[x][y].Type
	var area []Coord
	queue := []Coord{{X: x, Y: y}}

	for len(queue) > 0 {
		coord := queue[0]
		queue = queue[1:]

		key := fmt.Sprintf("%d,%d", coord.X, coord.Y)
		if visited[key] {
			continue
		}
		visited[key] = true

		if terrain[coord.X][coord.Y].Type == targetType {
			area = append(area, coord)

			neighborCoords := getNeighborCoords(coord.X, coord.Y, terrain)
			queue = append(queue, neighborCoords...)
		}
	}

	return area
}

// removeSmallIslands identifies and removes small land masses from the terrain.
// If removeSmall is true, any removed bodies are converted to Water.
func removeSmallIslands(terrain [][]Terrain, removeSmall bool) {
	if !removeSmall {
		return
	}

	visited := make(map[string]bool)

	type landBody struct {
		coords []Coord
		size   int
	}

	var landBodies []landBody

	// Find all distinct land bodies
	for x := 0; x < len(terrain); x++ {
		for y := 0; y < len(terrain[0]); y++ {
			if terrain[x][y].Type == Land {
				key := fmt.Sprintf("%d,%d", x, y)
				if visited[key] {
					continue
				}

				coords := getArea(x, y, terrain, visited)
				landBodies = append(landBodies, landBody{
					coords: coords,
					size:   len(coords),
				})
			}
		}
	}

	smallIslands := 0

	for _, body := range landBodies {
		if body.size < minIslandSize {
			smallIslands++
			for _, coord := range body.coords {
				terrain[coord.X][coord.Y].Type = Water
				terrain[coord.X][coord.Y].Magnitude = 0
			}
		}
	}

	log.Printf("Identified and removed %d islands smaller than %d tiles",
		smallIslands, minIslandSize)
}

// packTerrain serializes the terrain grid into a byte slice.
// Each byte represents a single tile with bit flags:
//   - Bit 7: Land (1) / Water (0)
//   - Bit 6: Shoreline
//   - Bit 5: Ocean
//   - Bits 0-4: Magnitude (0-31). For Water, this is (Distance / 2).
//
// Returns the packed data and the count of land tiles.
func packTerrain(terrain [][]Terrain) (data []byte, numLandTiles int) {
	width := len(terrain)
	height := len(terrain[0])
	packedData := make([]byte, width*height)
	numLandTiles = 0

	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			tile := terrain[x][y]
			var packedByte byte = 0

			if tile.Type == Land {
				packedByte |= 0b10000000
				numLandTiles++
			}
			if tile.Shoreline {
				packedByte |= 0b01000000
			}
			if tile.Ocean {
				packedByte |= 0b00100000
			}

			if tile.Type == Land {
				packedByte |= byte(math.Min(math.Ceil(tile.Magnitude), 31))
			} else {
				packedByte |= byte(math.Min(math.Ceil(tile.Magnitude/2), 31))
			}

			packedData[y*width+x] = packedByte
		}
	}

	logBinaryAsBits(packedData, 8)
	return packedData, numLandTiles
}

// createMapThumbnail generates an RGBA image representation of the terrain.
// It scales the map dimensions based on the provided quality factor.
// Each pixel's color is determined by the terrain type and magnitude via getThumbnailColor.
func createMapThumbnail(terrain [][]Terrain, quality float64) *image.RGBA {
	log.Println("Creating thumbnail")

	srcWidth := len(terrain)
	srcHeight := len(terrain[0])

	targetWidth := int(math.Max(1, math.Floor(float64(srcWidth)*quality)))
	targetHeight := int(math.Max(1, math.Floor(float64(srcHeight)*quality)))

	img := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))

	for x := 0; x < targetWidth; x++ {
		for y := 0; y < targetHeight; y++ {
			srcX := int(math.Floor(float64(x) / quality))
			srcY := int(math.Floor(float64(y) / quality))

			srcX = int(math.Min(float64(srcX), float64(srcWidth-1)))
			srcY = int(math.Min(float64(srcY), float64(srcHeight-1)))

			terrain := terrain[srcX][srcY]
			rgba := getThumbnailColor(terrain)
			img.Set(x, y, color.RGBA{R: rgba.R, G: rgba.G, B: rgba.B, A: rgba.A})
		}
	}

	return img
}

// RGBA represents a color with Red, Green, Blue, and Alpha channels.
// It is used locally for thumbnail generation.
type RGBA struct {
	R, G, B, A uint8
}

// getThumbnailColor determines the RGBA color for a specific terrain tile for
// the map preview thumbnail.
//
// It handles color generation for Water (shoreline vs deep water) and Land
// (shoreline, plains, highlands, mountains) based on the tile's magnitude.
//
// The thumbnail renders its own set of colors separate from the in-game light/dark
// color schemes.
//
// For thumbnail purposes, the terrain type -> color mapping:
//   - Water Shoreline: (Transparent)
//   - Deep Water: (Transparent)
//   - Land Shoreline: `rgb(204, 203, 158)`
//   - Plains (Mag < 10): `rgb(190, 220, 138)` - `rgb(190, 202, 138)`
//   - Highlands (Mag 10-19): `rgb(220, 203, 158)` - `rgb(238, 221, 176)`
//   - Mountains (Mag >= 20): `rgb(240, 240, 240)` - `rgb(245, 245, 245)`
func getThumbnailColor(t Terrain) RGBA {
	if t.Type == Water {
		// Shoreline water
		if t.Shoreline {
			return RGBA{R: 100, G: 143, B: 255, A: 0}
		}
		// Other water: adjust based on magnitude
		waterAdjRGB := 11 - math.Min(t.Magnitude/2, 10) - 10
		return RGBA{
			R: uint8(math.Max(70+waterAdjRGB, 0)),
			G: uint8(math.Max(132+waterAdjRGB, 0)),
			B: uint8(math.Max(180+waterAdjRGB, 0)),
			A: 0,
		}
	}

	// Shoreline land
	if t.Shoreline {
		return RGBA{R: 204, G: 203, B: 158, A: 255}
	}

	var adjRGB float64
	if t.Magnitude < 10 {
		// Plains
		adjRGB = 220 - 2*t.Magnitude
		return RGBA{
			R: 190,
			G: uint8(adjRGB),
			B: 138,
			A: 255,
		}
	} else if t.Magnitude < 20 {
		// Highlands
		adjRGB = 2 * t.Magnitude
		return RGBA{
			R: uint8(200 + adjRGB),
			G: uint8(183 + adjRGB),
			B: uint8(138 + adjRGB),
			A: 255,
		}
	} else {
		// Mountains
		adjRGB = math.Floor(230 + t.Magnitude/2)
		return RGBA{
			R: uint8(adjRGB),
			G: uint8(adjRGB),
			B: uint8(adjRGB),
			A: 255,
		}
	}
}

// logBinaryAsBits logs the binary representation of the first 'length' bytes of data.
// It is a helper function for debugging packed terrain data.
func logBinaryAsBits(data []byte, length int) {
	if length > len(data) {
		length = len(data)
	}

	var bits string
	for i := 0; i < length; i++ {
		bits += fmt.Sprintf("%08b ", data[i])
	}
	log.Printf("Binary data (bits): %s", bits)
}

// createCombinedBinary combines the info JSON, map data, and mini-map data into a single binary buffer.
//
// Note: This function is currently unused by the main workflow, which writes separate files instead.
// It creates a header with the following structure:
//   - Bytes 0-3: Version (1)
//   - Bytes 4-7: Info section offset
//   - Bytes 8-11: Info section size
//   - Bytes 12-15: Map section offset
//   - Bytes 16-19: Map section size
//   - Bytes 20-23: MiniMap section offset
//   - Bytes 24-27: MiniMap section size
func createCombinedBinary(infoBuffer []byte, mapData []byte, miniMapData []byte) []byte {
	// Calculate section sizes
	infoSize := len(infoBuffer)
	mapSize := len(mapData)
	miniMapSize := len(miniMapData)

	headerSize := 28
	infoOffset := headerSize
	mapOffset := infoOffset + infoSize
	miniMapOffset := mapOffset + mapSize

	totalSize := miniMapOffset + miniMapSize
	combined := make([]byte, totalSize)

	// Write version
	writeUint32(combined, 0, 1)

	// Write info section info
	writeUint32(combined, 4, uint32(infoOffset))
	writeUint32(combined, 8, uint32(infoSize))

	// Write map section info
	writeUint32(combined, 12, uint32(mapOffset))
	writeUint32(combined, 16, uint32(mapSize))

	// Write miniMap section info
	writeUint32(combined, 20, uint32(miniMapOffset))
	writeUint32(combined, 24, uint32(miniMapSize))

	// Copy data sections
	copy(combined[infoOffset:], infoBuffer)
	copy(combined[mapOffset:], mapData)
	copy(combined[miniMapOffset:], miniMapData)

	return combined
}

// writeUint32 writes a 32-bit unsigned integer to the byte slice at the specified offset.
// It uses Little Endian byte order.
// Note: This function is currently unused.
func writeUint32(data []byte, offset int, value uint32) {
	data[offset] = byte(value & 0xff)
	data[offset+1] = byte((value >> 8) & 0xff)
	data[offset+2] = byte((value >> 16) & 0xff)
	data[offset+3] = byte((value >> 24) & 0xff)
}

// readUint32 reads a 32-bit unsigned integer from the byte slice at the specified offset.
// It assumes Little Endian byte order.
// Note: This function is currently unused.
func readUint32(data []byte, offset int) uint32 {
	return uint32(data[offset]) | uint32(data[offset+1])<<8 | uint32(data[offset+2])<<16 | uint32(data[offset+3])<<24
}

// decodeCombinedBinary parses a combined binary buffer into its constituent parts.
// It validates the header and extracts the Info JSON, Map data, and MiniMap data sections.
// Note: This function is currently unused.
func decodeCombinedBinary(data []byte) (*CombinedBinaryHeader, []byte, []byte, []byte, error) {
	if len(data) < 28 {
		return nil, nil, nil, nil, fmt.Errorf("data too short for header")
	}

	header := &CombinedBinaryHeader{
		Version:       readUint32(data, 0),
		InfoOffset:    readUint32(data, 4),
		InfoSize:      readUint32(data, 8),
		MapOffset:     readUint32(data, 12),
		MapSize:       readUint32(data, 16),
		MiniMapOffset: readUint32(data, 20),
		MiniMapSize:   readUint32(data, 24),
	}

	// Validate offsets and sizes
	if header.InfoOffset+header.InfoSize > uint32(len(data)) ||
		header.MapOffset+header.MapSize > uint32(len(data)) ||
		header.MiniMapOffset+header.MiniMapSize > uint32(len(data)) {
		return nil, nil, nil, nil, fmt.Errorf("invalid offsets or sizes in header")
	}

	// Extract sections
	infoData := data[header.InfoOffset : header.InfoOffset+header.InfoSize]
	mapData := data[header.MapOffset : header.MapOffset+header.MapSize]
	miniMapData := data[header.MiniMapOffset : header.MiniMapOffset+header.MiniMapSize]

	return header, infoData, mapData, miniMapData, nil
}

// CombinedBinaryHeader represents the metadata header of the combined map file format.
// Note: This struct is currently unused.
type CombinedBinaryHeader struct {
	Version       uint32
	InfoOffset    uint32
	InfoSize      uint32
	MapOffset     uint32
	MapSize       uint32
	MiniMapOffset uint32
	MiniMapSize   uint32
}
