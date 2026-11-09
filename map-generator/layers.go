package main

import (
	"bytes"
	"image"
	"image/draw"

	"github.com/gen2brain/webp"
)

// Lossy q90 is ~9x smaller than the authored PNG on photographic layers and
// indistinguishable at the game's nearest-neighbour sampling; lossless WebP
// only saves ~1.5x. The CDN serves images as-is, so this is the whole saving.
const layerWebPQuality = 90

// cropToNRGBA returns the top-left width x height pixels of img as NRGBA,
// which is also what the WebP encoder wants (palette PNGs decode as Paletted).
func cropToNRGBA(img image.Image, width, height int) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(dst, dst.Bounds(), img, img.Bounds().Min, draw.Src)
	return dst
}

// downscaleHalf box-filters src to width x height, the map4x grid (map
// dimensions are multiples of 4, so every output pixel covers a full 2x2
// block). Colour is alpha-weighted: fully transparent pixels carry no colour
// information and would otherwise bleed dark fringes into layer edges.
func downscaleHalf(src *image.NRGBA, width, height int) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			var r, g, b, a uint32
			for dy := 0; dy < 2; dy++ {
				i := src.PixOffset(2*x, 2*y+dy)
				for dx := 0; dx < 2; dx++ {
					p := src.Pix[i : i+4]
					pa := uint32(p[3])
					r += uint32(p[0]) * pa
					g += uint32(p[1]) * pa
					b += uint32(p[2]) * pa
					a += pa
					i += 4
				}
			}
			o := dst.PixOffset(x, y)
			if a == 0 {
				continue
			}
			dst.Pix[o] = uint8((r + a/2) / a)
			dst.Pix[o+1] = uint8((g + a/2) / a)
			dst.Pix[o+2] = uint8((b + a/2) / a)
			dst.Pix[o+3] = uint8((a + 2) / 4)
		}
	}
	return dst
}

func encodeLayerWebP(img *image.NRGBA) ([]byte, error) {
	var buf bytes.Buffer
	if err := webp.Encode(&buf, img, webp.Options{Quality: layerWebPQuality, Method: 4}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
