// This is the custom logger providing the multi-level and flag-based logging for
// the map-generator.  It uses slog.
package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
)

// Flags supported for conditional logging
type LogFlags struct {
	performance bool
	removal     bool
}

// LevelAll allows for manually setting a log level that outputs all messages, regardless of other passed flags
const LevelAll = slog.Level(-8)

// PerformanceLogTag is a slog attribute used to tag performance-related log messages.
var PerformanceLogTag = slog.String("tag", "performance")

// RemovalLogTag is a slog attribute used to tag land/water removal-related log messages.
var RemovalLogTag = slog.String("tag", "removal")

// GeneratorLogger is a custom slog.Handler that outputs logs based on log level and performance flags.
type GeneratorLogger struct {
	opts   slog.HandlerOptions
	w      io.Writer
	mu     *sync.Mutex
	attrs  []slog.Attr
	prefix string
	flags  LogFlags
}

// NewGeneratorLogger creates a new GeneratorLogger.
// It initializes a handler with specific output, options, and flags
func NewGeneratorLogger(
	out io.Writer,
	opts *slog.HandlerOptions,
	flags LogFlags) *GeneratorLogger {

	h := &GeneratorLogger{
		w:     out,
		mu:    &sync.Mutex{},
		flags: flags,
	}
	if opts != nil {
		h.opts = *opts
	}
	if h.opts.Level == nil {
		h.opts.Level = slog.LevelInfo
	}
	return h
}

// Enabled checks if a given log level is enabled for this handler.
func (h *GeneratorLogger) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.opts.Level.Level()
}

// Handle processes a log record.
// It formats the log message and decides whether to output it based on log level and flags
func (h *GeneratorLogger) Handle(_ context.Context, r slog.Record) error {
	isPerformanceLog := false
	isRemovalLog := false
	var mapName string

	findAttrs := func(a slog.Attr) {
		if a.Equal(PerformanceLogTag) {
			isPerformanceLog = true
		}
		if a.Equal(RemovalLogTag) {
			isRemovalLog = true
		}
		if a.Key == "map" {
			mapName = a.Value.String()
		}
	}

	// Check record attributes for performance tag and map name
	r.Attrs(func(a slog.Attr) bool {
		findAttrs(a)
		return true
	})

	// Check handler's own attributes for performance tag and map name
	for _, a := range h.attrs {
		findAttrs(a)
	}

	// Don't log messages if the flags are not set
	// If the log level is set to LevelAll, disregard
	if h.opts.Level != LevelAll && isPerformanceLog && !h.flags.performance {
		return nil
	}
	if h.opts.Level != LevelAll && (isRemovalLog && !h.flags.removal) {
		return nil
	}

	buf := &bytes.Buffer{}

	// Add map name as a prefix in log Level DEBUG and ALL
	if h.opts.Level == slog.LevelDebug || h.opts.Level == LevelAll && mapName != "" {
		mapName = strings.Trim(mapName, `"`)
		fmt.Fprintf(buf, "[%s] ", mapName)
	}

	// Add prefix for performance messages
	if isPerformanceLog {
		fmt.Fprintf(buf, "[PERF] ")
	}

	fmt.Fprintln(buf, r.Message)

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := h.w.Write(buf.Bytes())
	return err
}

// WithAttrs returns a new handler with the given attributes added.
func (h *GeneratorLogger) WithAttrs(attrs []slog.Attr) slog.Handler {
	newHandler := *h
	newHandler.attrs = append(newHandler.attrs, attrs...)
	return &newHandler
}

// WithGroup returns a new handler with the given group name.
// The group name is added as a prefix to subsequent log messages.
func (h *GeneratorLogger) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	newHandler := *h
	if newHandler.prefix != "" {
		newHandler.prefix += "."
	}
	newHandler.prefix += name
	return &newHandler
}

type loggerKey struct{}

// LoggerFromContext retrieves the logger from the context.
// If no logger is found, it returns the default logger.
func LoggerFromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// ContextWithLogger returns a new context with the provided logger.
func ContextWithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, logger)
}
