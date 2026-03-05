pub struct MapBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lon: f64,
    pub max_lon: f64,
    pub grid_width: u32,
    pub grid_height: u32,
}

impl MapBounds {
    pub fn new(grid_width: u32, grid_height: u32) -> Self {
        Self {
            min_lat: -90.0, max_lat: 90.0,
            min_lon: -180.0, max_lon: 180.0,
            grid_width, grid_height,
        }
    }

    pub fn project_wgs84_to_grid(&self, lat: f64, lon: f64) -> Option<(u32, u32)> {
        if lat < self.min_lat || lat > self.max_lat || lon < self.min_lon || lon > self.max_lon {
            return None;
        }

        let lon_scalar = (lon - self.min_lon) / (self.max_lon - self.min_lon);
        let lat_scalar = (lat - self.min_lat) / (self.max_lat - self.min_lat);

        let x = (lon_scalar * self.grid_width as f64).round() as u32;
        let y = ((1.0 - lat_scalar) * self.grid_height as f64).round() as u32;

        let x = x.clamp(0, self.grid_width.saturating_sub(1));
        let y = y.clamp(0, self.grid_height.saturating_sub(1));

        Some((x, y))
    }
}