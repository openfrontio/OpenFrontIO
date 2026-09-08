package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// runPrettier formats the given files in place using the repo's Prettier
// config (../.prettierrc), the same tool `npm run format` and CI's
// `npx prettier --check .` job use. It runs from the repo root so relative
// paths and config discovery behave exactly as they do for `npm run format`.
//
// Only the given files are touched — unlike `npm run format`, this does not
// reformat the whole repo, so it's safe to run on every `go run .`,
// including `--maps=<one map>` runs.
func runPrettier(files []string) error {
	if len(files) == 0 {
		return nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get working directory: %w", err)
	}
	repoRoot := filepath.Join(cwd, "..")

	args := []string{"--no-install", "prettier", "--write"}
	for _, f := range files {
		rel, err := filepath.Rel(repoRoot, f)
		if err != nil {
			return fmt.Errorf("failed to compute relative path for %s: %w", f, err)
		}
		args = append(args, filepath.ToSlash(rel))
	}

	cmd := exec.Command("npx", args...)
	cmd.Dir = repoRoot
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("npx prettier --write failed (is `npm ci` up to date?): %w", err)
	}
	return nil
}
