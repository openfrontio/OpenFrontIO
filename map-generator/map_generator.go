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

const (
	minIslandSize = 30
	minLakeSize   = 200
)

type ThumbData struct {
	Data   []byte
	Width  int
	Height int
}

type Coord struct {
	X, Y int
}

type TerrainType int

const (
	Land TerrainType = iota
	Water
)

type Terrain struct {
	Type      TerrainType
	Shoreline bool
	Magnitude float64
	Ocean     bool
}

type MapResult struct {
	Thumbnail []byte
	Map MapInfo
	Map4x MapInfo
	Map16x MapInfo
}

type MapInfo struct {
	Data []byte
	Width int
	Height int
	NumLandTiles int
}

type GeneratorArgs struct {
	Name string
	ImageBuffer []byte
	RemoveSmall bool
}

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
	terrain16x := createMiniMap(terrain4x)

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
			Data: mapData,
			Width: width,
			Height: height,
			NumLandTiles: mapNumLandTiles,
		},
		Map4x: MapInfo{
			Data: mapData4x,
			Width: width / 2,
			Height: height / 2,
			NumLandTiles: numLandTiles4x,
		},
		Map16x: MapInfo{
			Data: mapData16x,
			Width: width / 4,
			Height: height / 4,
			NumLandTiles: numLandTiles16x,
		},
		Thumbnail: webp,
	}, nil
}

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

func getNeighbors(x, y int, terrain [][]Terrain) []Terrain {
	coords := getNeighborCoords(x, y, terrain)
	neighbors := make([]Terrain, len(coords))
	for i, coord := range coords {
		neighbors[i] = terrain[coord.X][coord.Y]
	}
	return neighbors
}

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

type RGBA struct {
	R, G, B, A uint8
}

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

func createCombinedBinary(infoBuffer []byte, mapData []byte, miniMapData []byte) []byte {
	// Calculate section sizes
	infoSize := len(infoBuffer)
	mapSize := len(mapData)
	miniMapSize := len(miniMapData)
	
	// Header structure:
	// Bytes 0-3: Version (1)
	// Bytes 4-7: Info section offset (always 28)
	// Bytes 8-11: Info section size
	// Bytes 12-15: Map section offset
	// Bytes 16-19: Map section size
	// Bytes 20-23: MiniMap section offset
	// Bytes 24-27: MiniMap section size
	
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

func writeUint32(data []byte, offset int, value uint32) {
	data[offset] = byte(value & 0xff)
	data[offset+1] = byte((value >> 8) & 0xff)
	data[offset+2] = byte((value >> 16) & 0xff)
	data[offset+3] = byte((value >> 24) & 0xff)
}

func readUint32(data []byte, offset int) uint32 {
	return uint32(data[offset]) | uint32(data[offset+1])<<8 | uint32(data[offset+2])<<16 | uint32(data[offset+3])<<24
}

func decodeCombinedBinary(data []byte) (*CombinedBinaryHeader, []byte, []byte, []byte, error) {
	if len(data) < 28 {
		return nil, nil, nil, nil, fmt.Errorf("data too short for header")
	}
	
	header := &CombinedBinaryHeader{
		Version:      readUint32(data, 0),
		InfoOffset:   readUint32(data, 4),
		InfoSize:     readUint32(data, 8),
		MapOffset:    readUint32(data, 12),
		MapSize:      readUint32(data, 16),
		MiniMapOffset: readUint32(data, 20),
		MiniMapSize:  readUint32(data, 24),
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

type CombinedBinaryHeader struct {
	Version      uint32
	InfoOffset   uint32
	InfoSize     uint32
	MapOffset    uint32
	MapSize      uint32
	MiniMapOffset uint32
	MiniMapSize  uint32
}