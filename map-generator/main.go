package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var maps = []struct {
	Name   string
	IsTest bool
}{
	{Name: "africa"},
	{Name: "asia"},
	{Name: "world"},
	{Name: "giantworldmap"},
	{Name: "blacksea"},
	{Name: "europe"},
	{Name: "europeclassic"},
	{Name: "mars"},
	{Name: "mena"},
	{Name: "oceania"},
	{Name: "northamerica"},
	{Name: "southamerica"},
	{Name: "britannia"},
	{Name: "gatewaytotheatlantic"},
	{Name: "australia"},
	{Name: "pangaea"},
	{Name: "iceland"},
	{Name: "betweentwoseas"},
	{Name: "eastasia"},
	{Name: "faroeislands"},
	{Name: "deglaciatedantarctica"},
	{Name: "falklandislands"},
	{Name: "baikal"},
	{Name: "halkidiki"},
	{Name: "italia"},
	{Name: "straitofgibraltar"},
	{Name: "pluto"},
	{Name: "big_plains", IsTest: true},
	{Name: "half_land_half_ocean", IsTest: true},
	{Name: "ocean_and_land", IsTest: true},
	{Name: "plains", IsTest: true},
}

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


func processMap(name string, isTest bool) error {
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
	result, err := GenerateMap(GeneratorArgs{
		ImageBuffer: imageBuffer,
		RemoveSmall: !isTest, // Don't remove small islands for test maps
		Name:        name,
	})
	if err != nil {
		return fmt.Errorf("failed to generate map for %s: %w", name, err)
	}

	manifest["map"] = map[string]interface{}{
		"width": result.MapWidth,
		"height": result.MapHeight,
		"num_land_tiles": result.MapNumLandTiles,
	}	
	manifest["mini_map"] = map[string]interface{}{
		"width": result.MiniMapWidth,
		"height": result.MiniMapHeight,
		"num_land_tiles": result.MiniMapNumLandTiles,
	}

	mapDir := filepath.Join(outputMapBaseDir, name)
	if err := os.MkdirAll(mapDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "map.bin"), result.Map, 0644); err != nil {
		return fmt.Errorf("failed to write combined binary for %s: %w", name, err)
	}
	if err := os.WriteFile(filepath.Join(mapDir, "mini_map.bin"), result.MiniMap, 0644); err != nil {
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

func loadTerrainMaps() error {
	var wg sync.WaitGroup
	errChan := make(chan error, len(maps))

	// Process maps concurrently
	for _, mapItem := range maps {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := processMap(mapItem.Name, mapItem.IsTest); err != nil {
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

func main() {
	if err := loadTerrainMaps(); err != nil {
		log.Fatalf("Error generating terrain maps: %v", err)
	}
	
	fmt.Println("Terrain maps generated successfully")
}