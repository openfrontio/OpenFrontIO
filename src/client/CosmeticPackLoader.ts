export function fetchUrl(
  packId: string | undefined,
  type: string,
): string | undefined {
  // TODO: Fetches the resource URL from the API server.

  // Request parameters:
  //   - packKey: identifier of the cosmetic pack
  //   - type: asset type (e.g., "structurePort", "structureCity")
  // Response:
  //   - URL string pointing to the requested asset

  // Even if this approach changes, this function will be responsible for obtaining the URL by some method.

  switch (packId) {
    case "base":
      return;
    case "test":
      return "/images/test/test.png"; // Example URL for testing
  }
  return;
}
