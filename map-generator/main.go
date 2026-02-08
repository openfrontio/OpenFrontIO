package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// maps defines the registry of available maps to be processed.
// Each entry contains the folder name and a flag indicating if it's a test map.
//
// New maps need to be added here in order to allow the map-generator to process them.
var maps = []struct {
	Name   string
	IsTest bool
}{
	{Name: "africa"},
	{Name: "asia"},
	{Name: "australia"},
	{Name: "achiran"},
	{Name: "baikal"},
	{Name: "baikalnukewars"},
	{Name: "betweentwoseas"},
	{Name: "blacksea"},
	{Name: "bosphorusstraits"},
	{Name: "britannia"},
	{Name: "britanniaclassic"},
	{Name: "deglaciatedantarctica"},
	{Name: "eastasia"},
	{Name: "europe"},
	{Name: "europeclassic"},
	{Name: "falklandislands"},
	{Name: "faroeislands"},
	{Name: "fourislands"},
	{Name: "gatewaytotheatlantic"},
	{Name: "giantworldmap"},
	{Name: "gulfofstlawrence"},
	{Name: "halkidiki"},
	{Name: "iceland"},
	{Name: "italia"},
	{Name: "japan"},
	{Name: "lisbon"},
	{Name: "manicouagan"},
	{Name: "mars"},
	{Name: "mena"},
	{Name: "montreal"},
	{Name: "newyorkcity"},
	{Name: "northamerica"},
	{Name: "oceania"},
	{Name: "pangaea"},
	{Name: "pluto"},
	{Name: "sierpinski"},
	{Name: "southamerica"},
	{Name: "straitofgibraltar"},
	{Name: "surrounded"},
	{Name: "svalmel"},
	{Name: "world"},
	{Name: "lemnos"},
	{Name: "twolakes"},
  {Name: "thebox"},
	{Name: "didier"},
	{Name: "didierfrance"},
	{Name: "amazonriver"},
	{Name: "yenisei"},
	{Name: "big_plains", IsTest: true},
	{Name: "half_land_half_ocean", IsTest: true},
	{Name: "ocean_and_land", IsTest: true},
	{Name: "plains", IsTest: true},
	{Name: "giantworldmap", IsTest: true},
	{Name: "world", IsTest: true},
}

// mapsFlag holds the comma-separated list of map names passed via the --maps command-line argument.
var mapsFlag string

// logFlags holds all the flags related to configuring the map-generator logging
var logFlags LogFlags

// outputMapDir returns the absolute path to the directory where generated map files should be written.
// It distinguishes between test and production output locations.
func outputMapDir(isTest bool) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}
	if isTest {
		return filepath.Join(cwd, "..", "tests", "testdata", "maps"), nil
	}
	return filepath.Join(cwd, "..", "resources", "maps"), nil
}

// inputMapDir returns the absolute path to the directory containing source map assets.
// It distinguishes between test and production asset locations.
func inputMapDir(isTest bool) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}
	if isTest {
		return filepath.Join(cwd, "assets", "test_maps"), nil
	} else {
		return filepath.Join(cwd, "assets", "maps"), nil
	}
}

// processMap handles the end-to-end generation for a single map.
// It reads the source image and JSON, generates the terrain data, and writes the binary outputs and updated manifest.
func processMap(ctx context.Context, name string, isTest bool) error {
	outputMapBaseDir, err := outputMapDir(isTest)
	if err != nil {
		return fmt.Errorf("failed to get map directory: %w", err)
	}

	inputMapDir, err := inputMapDir(isTest)
	if err != nil {
		return fmt.Errorf("failed to get input map directory: %w", err)
	}

	inputPath := filepath.Join(inputMapDir, name, "image.png")
	imageBuffer, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("failed to read map file %s: %w", inputPath, err)
	}

	// Read the info.json file
	manifestPath := filepath.Join(inputMapDir, name, "info.json")
	manifestBuffer, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("failed to read info file %s: %w", manifestPath, err)
	}

	// Parse the info buffer as dynamic JSON
	var manifest map[string]interface{}
	if err := json.Unmarshal(manifestBuffer, &manifest); err != nil {
		return fmt.Errorf("failed to parse info.json for %s: %w", name, err)
	}

	// Generate maps
	result, err := GenerateMap(ctx, GeneratorArgs{
		ImageBuffer: imageBuffer,
		RemoveSmall: !isTest, // Don't remove small islands for test maps
		Name:        name,
	})
	if err != nil {
		return fmt.Errorf("failed to generate map for %s: %w", name, err)
	}

	manifest["map"] = map[string]interface{}{
		"width":          result.Map.Width,
		"height":         result.Map.Height,
		"num_land_tiles": result.Map.NumLandTiles,
	}
	manifest["map4x"] = map[string]interface{}{
		"width":          result.Map4x.Width,
		"height":         result.Map4x.Height,
		"num_land_tiles": result.Map4x.NumLandTiles,
	}
	manifest["map16x"] = map[string]interface{}{
		"width":          result.Map16x.Width,
		"height":         result.Map16x.Height,
		"num_land_tiles": result.Map16x.NumLandTiles,
	}

	mapDir := filepath.Join(outputMapBaseDir, name)
	if err := os.MkdirAll(mapDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "map.bin"), result.Map.Data, 0644); err != nil {
		return fmt.Errorf("failed to write combined binary for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "map4x.bin"), result.Map4x.Data, 0644); err != nil {
		return fmt.Errorf("failed to write combined binary for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "map16x.bin"), result.Map16x.Data, 0644); err != nil {
		return fmt.Errorf("failed to write combined binary for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "thumbnail.webp"), result.Thumbnail, 0644); err != nil {
		return fmt.Errorf("failed to write thumbnail for %s: %w", name, err)
	}

	// Serialize the updated manifest to JSON
	updatedManifest, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize manifest for %s: %w", name, err)
	}

	if err := os.WriteFile(filepath.Join(mapDir, "manifest.json"), updatedManifest, 0644); err != nil {
		return fmt.Errorf("failed to write manifest for %s: %w", name, err)
	}
	return nil
}

// parseMapsFlag validates and parses the --maps command-line argument.
// It returns a set of selected map names or nil if no flag was provided (implying all maps).
func parseMapsFlag() (map[string]bool, error) {
	if mapsFlag == "" {
		return nil, nil
	}

	validNames := make(map[string]bool, len(maps))
	for _, m := range maps {
		validNames[m.Name] = true
	}

	selected := make(map[string]bool)
	for _, name := range strings.Split(mapsFlag, ",") {
		if !validNames[name] {
			return nil, fmt.Errorf("map %q is not defined", name)
		}
		selected[name] = true
	}
	return selected, nil
}

// loadTerrainMaps manages the concurrent generation of all selected maps.
// It spins up goroutines for each map and aggregates any errors.
func loadTerrainMaps() error {
	selectedMaps, err := parseMapsFlag()
	if err != nil {
		return err
	}
	var wg sync.WaitGroup
	errChan := make(chan error, len(maps))

	// Process maps concurrently
	for _, mapItem := range maps {
		if selectedMaps != nil && !selectedMaps[mapItem.Name] {
			continue
		}
		wg.Add(1)
		mapItem := mapItem
		go func() {
			defer wg.Done()
			mapLogTag := slog.String("map", mapItem.Name)
			testLogTag := slog.Bool("isTest", mapItem.IsTest)
			logger := slog.Default().With(mapLogTag).With(testLogTag)
			ctx := ContextWithLogger(context.Background(), logger)
			if err := processMap(ctx, mapItem.Name, mapItem.IsTest); err != nil {
				errChan <- err
			}
		}()
	}

	// Wait for all goroutines to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	for err := range errChan {
		if err != nil {
			return err
		}
	}

	return nil
}

// main is the entry point for the map generator tool.
// It parses flags and triggers the map generation process.
func main() {
	flag.StringVar(&mapsFlag, "maps", "", "optional comma-separated list of maps to process. ex: --maps=world,eastasia,big_plains")
	flag.StringVar(&logFlags.logLevel, "log-level", "", "Explicitly sets the log level to one of: ALL, DEBUG, INFO (default), WARN, ERROR.")
	flag.BoolVar(&logFlags.verbose, "verbose", false, "Adds additional logging and prefixes logs with the [mapname].  Alias of log-level=DEBUG.")
	flag.BoolVar(&logFlags.verbose, "v", false, "-verbose shorthand")
	flag.BoolVar(&logFlags.performance, "log-performance", false, "Adds additional logging for performance-based recommendations, sets log-level=DEBUG")
	flag.BoolVar(&logFlags.removal, "log-removal", false, "Adds additional logging of removed island and lake position/size, sets log-level=DEBUG")
	flag.Parse()

	logger := slog.New(NewGeneratorLogger(
		os.Stdout,
		&slog.HandlerOptions{
			Level: DetermineLogLevel(logFlags),
		},
		logFlags,
	))

	slog.SetDefault(logger)

	if err := loadTerrainMaps(); err != nil {
		log.Fatalf("Error generating terrain maps: %v", err)
	}

	fmt.Println("Terrain maps generated successfully")
}
