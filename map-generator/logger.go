package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
)

var PerformanceLogTag = slog.String("tag", "performance")

// PrettyHandler is a custom slog.Handler that outputs logs with each property on a separate line.
type PrettyHandler struct {
	opts   slog.HandlerOptions
	w      io.Writer
	mu     *sync.Mutex
	attrs  []slog.Attr
	prefix string
}

// NewPrettyHandler creates a new PrettyHandler.
func NewPrettyHandler(out io.Writer, opts *slog.HandlerOptions) *PrettyHandler {
	h := &PrettyHandler{
		w:  out,
		mu: &sync.Mutex{},
	}
	if opts != nil {
		h.opts = *opts
	}
	if h.opts.Level == nil {
		h.opts.Level = slog.LevelInfo
	}
	return h
}

func (h *PrettyHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.opts.Level.Level()
}

func (h *PrettyHandler) Handle(_ context.Context, r slog.Record) error {
	buf := &bytes.Buffer{}

	if r.Message != "" {
		fmt.Fprintf(buf, "msg: %s\n", r.Message)
	}

	currentAttrs := h.attrs
	r.Attrs(func(a slog.Attr) bool {
		currentAttrs = append(currentAttrs, a)
		return true
	})

	for _, a := range currentAttrs {
		h.appendAttr(buf, a, h.prefix)
	}

	buf.WriteString("--\n")

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := h.w.Write(buf.Bytes())
	return err
}

func (h *PrettyHandler) appendAttr(buf *bytes.Buffer, a slog.Attr, prefix string) {
	key := a.Key
	if prefix != "" {
		key = prefix + "." + key
	}

	if a.Value.Kind() == slog.KindGroup {
		if key != "" {
			prefix = key
		}
		for _, groupAttr := range a.Value.Group() {
			h.appendAttr(buf, groupAttr, prefix)
		}
	} else if key != "" {
		fmt.Fprintf(buf, "%s: %s\n", key, a.Value)
	}
}

func (h *PrettyHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newHandler := *h
	newHandler.attrs = append(newHandler.attrs, attrs...)
	return &newHandler
}

func (h *PrettyHandler) WithGroup(name string) slog.Handler {
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
