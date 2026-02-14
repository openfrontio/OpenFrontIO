//! A* pathfinding algorithm for water navigation with bounded search regions
//!
//! This is a direct port of the TypeScript AStarWaterBounded implementation
//! optimized for WASM execution. Used for cluster-local pathfinding in HPA.

use wasm_bindgen::prelude::*;

const LAND_BIT: u8 = 7;
const MAGNITUDE_MASK: u8 = 0x1f;
const COST_SCALE: u32 = 100;
const BASE_COST: u32 = 1 * COST_SCALE;

/// Get penalty based on water magnitude (distance from shore)
/// Prefer magnitude 3-10 (3-10 tiles from shore)
#[inline(always)]
fn get_magnitude_penalty(magnitude: u8) -> u32 {
    if magnitude < 3 {
        3 * COST_SCALE // too close to shore
    } else if magnitude <= 10 {
        0 // sweet spot
    } else {
        1 * COST_SCALE // deep water, slight penalty
    }
}

/// A* pathfinding for water navigation with bounded search region
/// Uses stamping technique for efficient memory reuse without clearing arrays
#[wasm_bindgen]
pub struct AStarWaterBounded {
    terrain: Vec<u8>,
    map_width: u32,
    #[allow(dead_code)]
    map_height: u32,
    max_search_area: usize,
    heuristic_weight: u32,
    max_iterations: u32,

    // Pre-allocated arrays for pathfinding (sized for max search area)
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    stamp: u32,

    // Priority queue (inline min-heap for performance)
    heap_nodes: Vec<u32>,
    heap_priorities: Vec<u32>,
    heap_size: usize,
}

#[wasm_bindgen]
impl AStarWaterBounded {
    /// Create a new AStarWaterBounded pathfinder
    ///
    /// # Arguments
    /// * `terrain` - Uint8Array of terrain data
    /// * `map_width` - Full map width
    /// * `map_height` - Full map height
    /// * `max_search_area` - Maximum number of nodes in a bounded search region
    /// * `heuristic_weight` - Weight for heuristic (default 3)
    /// * `max_iterations` - Maximum iterations before giving up (default 100_000)
    #[wasm_bindgen(constructor)]
    pub fn new(
        terrain: &[u8],
        map_width: u32,
        map_height: u32,
        max_search_area: u32,
        heuristic_weight: Option<u32>,
        max_iterations: Option<u32>,
    ) -> Self {
        let max_search_area = max_search_area as usize;
        let heuristic_weight = heuristic_weight.unwrap_or(3);
        let max_iterations = max_iterations.unwrap_or(100_000);

        Self {
            terrain: terrain.to_vec(),
            map_width,
            map_height,
            max_search_area,
            heuristic_weight,
            max_iterations,
            closed_stamp: vec![0; max_search_area],
            g_score_stamp: vec![0; max_search_area],
            g_score: vec![0; max_search_area],
            came_from: vec![-1; max_search_area],
            stamp: 1,
            heap_nodes: vec![0; max_search_area * 4],
            heap_priorities: vec![0; max_search_area * 4],
            heap_size: 0,
        }
    }

    /// Find path from start to goal, automatically computing bounds
    /// Returns null if no path found
    #[wasm_bindgen(js_name = findPath)]
    pub fn find_path(&mut self, start: u32, goal: u32) -> Option<Vec<u32>> {
        let goal_x = goal % self.map_width;
        let goal_y = goal / self.map_width;
        let start_x = start % self.map_width;
        let start_y = start / self.map_width;

        let min_x = goal_x.min(start_x);
        let max_x = goal_x.max(start_x);
        let min_y = goal_y.min(start_y);
        let max_y = goal_y.max(start_y);

        self.search_bounded(&[start], goal, min_x, max_x, min_y, max_y)
    }

    /// Find path from multiple start positions to goal, automatically computing bounds
    #[wasm_bindgen(js_name = findPathMulti)]
    pub fn find_path_multi(&mut self, starts: &[u32], goal: u32) -> Option<Vec<u32>> {
        let goal_x = goal % self.map_width;
        let goal_y = goal / self.map_width;

        let mut min_x = goal_x;
        let mut max_x = goal_x;
        let mut min_y = goal_y;
        let mut max_y = goal_y;

        for &s in starts {
            let sx = s % self.map_width;
            let sy = s / self.map_width;
            min_x = min_x.min(sx);
            max_x = max_x.max(sx);
            min_y = min_y.min(sy);
            max_y = max_y.max(sy);
        }

        self.search_bounded(starts, goal, min_x, max_x, min_y, max_y)
    }

    /// Find path within explicit bounds
    #[wasm_bindgen(js_name = searchBounded)]
    pub fn search_bounded_js(
        &mut self,
        start: u32,
        goal: u32,
        min_x: u32,
        max_x: u32,
        min_y: u32,
        max_y: u32,
    ) -> Option<Vec<u32>> {
        self.search_bounded(&[start], goal, min_x, max_x, min_y, max_y)
    }

    /// Find path from multiple starts within explicit bounds
    #[wasm_bindgen(js_name = searchBoundedMulti)]
    pub fn search_bounded_multi_js(
        &mut self,
        starts: &[u32],
        goal: u32,
        min_x: u32,
        max_x: u32,
        min_y: u32,
        max_y: u32,
    ) -> Option<Vec<u32>> {
        self.search_bounded(starts, goal, min_x, max_x, min_y, max_y)
    }

    fn search_bounded(
        &mut self,
        starts: &[u32],
        goal: u32,
        min_x: u32,
        max_x: u32,
        min_y: u32,
        max_y: u32,
    ) -> Option<Vec<u32>> {
        // Increment stamp, reset if overflow
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }

        let stamp = self.stamp;
        let map_width = self.map_width;
        let weight = self.heuristic_weight;
        let land_mask = 1u8 << LAND_BIT;

        let bounds_width = max_x - min_x + 1;
        let bounds_height = max_y - min_y + 1;
        let num_local_nodes = (bounds_width * bounds_height) as usize;

        if num_local_nodes > self.max_search_area {
            return None;
        }

        let goal_x = goal % map_width;
        let goal_y = goal / map_width;

        // Clamp goal to bounds
        let goal_x_clamped = goal_x.clamp(min_x, max_x);
        let goal_y_clamped = goal_y.clamp(min_y, max_y);
        let goal_local = (goal_y_clamped - min_y) * bounds_width + (goal_x_clamped - min_x);

        // Clear heap
        self.heap_size = 0;

        // Cross-product tie-breaker setup
        let s0 = starts[0];
        let start_x = (s0 % map_width).clamp(min_x, max_x);
        let start_y = (s0 / map_width).clamp(min_y, max_y);
        let dx_goal = goal_x as i32 - start_x as i32;
        let dy_goal = goal_y as i32 - start_y as i32;
        let cross_norm = (dx_goal.abs() + dy_goal.abs()).max(1) as u32;

        // Initialize with start positions
        for &s in starts {
            let sx = (s % map_width).clamp(min_x, max_x);
            let sy = (s / map_width).clamp(min_y, max_y);
            let start_local = ((sy - min_y) * bounds_width + (sx - min_x)) as usize;

            if start_local >= num_local_nodes {
                continue;
            }

            self.g_score[start_local] = 0;
            self.g_score_stamp[start_local] = stamp;
            self.came_from[start_local] = -1;

            let h = weight * BASE_COST * (abs_diff(sx, goal_x) + abs_diff(sy, goal_y));
            self.heap_push(start_local as u32, h);
        }

        let mut iterations = self.max_iterations;

        while self.heap_size > 0 {
            iterations -= 1;
            if iterations == 0 {
                return None;
            }

            let current_local = self.heap_pop() as usize;

            if self.closed_stamp[current_local] == stamp {
                continue;
            }
            self.closed_stamp[current_local] = stamp;

            if current_local as u32 == goal_local {
                return Some(self.build_path(
                    goal_local,
                    min_x,
                    min_y,
                    bounds_width,
                    map_width,
                    num_local_nodes,
                ));
            }

            let current_g = self.g_score[current_local];

            // Convert local to global coords
            let local_x = (current_local as u32) % bounds_width;
            let local_y = (current_local as u32) / bounds_width;
            let current_x = local_x + min_x;
            let current_y = local_y + min_y;
            let current_global = current_y * map_width + current_x;

            // Process 4 neighbors inline to avoid borrow issues
            // Up
            if current_y > min_y {
                let neighbor_global = current_global - map_width;
                let neighbor_local = current_local - bounds_width as usize;
                let neighbor_terrain = self.terrain[neighbor_global as usize];

                if self.closed_stamp[neighbor_local] != stamp
                    && (neighbor_global == goal || (neighbor_terrain & land_mask) == 0)
                {
                    let magnitude = neighbor_terrain & MAGNITUDE_MASK;
                    let cost = BASE_COST + get_magnitude_penalty(magnitude);
                    let tentative_g = current_g + cost;
                    let neighbor_y = current_y - 1;

                    if self.g_score_stamp[neighbor_local] != stamp
                        || tentative_g < self.g_score[neighbor_local]
                    {
                        self.came_from[neighbor_local] = current_local as i32;
                        self.g_score[neighbor_local] = tentative_g;
                        self.g_score_stamp[neighbor_local] = stamp;

                        let dist_to_goal =
                            abs_diff(current_x, goal_x) + abs_diff(neighbor_y, goal_y);
                        let h = weight * BASE_COST * dist_to_goal;
                        let cross_tie_breaker = cross_product_tie_breaker(
                            current_x, neighbor_y, goal_x, goal_y, dx_goal, dy_goal, cross_norm,
                        );
                        self.heap_push(neighbor_local as u32, tentative_g + h + cross_tie_breaker);
                    }
                }
            }

            // Down
            if current_y < max_y {
                let neighbor_global = current_global + map_width;
                let neighbor_local = current_local + bounds_width as usize;
                let neighbor_terrain = self.terrain[neighbor_global as usize];

                if self.closed_stamp[neighbor_local] != stamp
                    && (neighbor_global == goal || (neighbor_terrain & land_mask) == 0)
                {
                    let magnitude = neighbor_terrain & MAGNITUDE_MASK;
                    let cost = BASE_COST + get_magnitude_penalty(magnitude);
                    let tentative_g = current_g + cost;
                    let neighbor_y = current_y + 1;

                    if self.g_score_stamp[neighbor_local] != stamp
                        || tentative_g < self.g_score[neighbor_local]
                    {
                        self.came_from[neighbor_local] = current_local as i32;
                        self.g_score[neighbor_local] = tentative_g;
                        self.g_score_stamp[neighbor_local] = stamp;

                        let dist_to_goal =
                            abs_diff(current_x, goal_x) + abs_diff(neighbor_y, goal_y);
                        let h = weight * BASE_COST * dist_to_goal;
                        let cross_tie_breaker = cross_product_tie_breaker(
                            current_x, neighbor_y, goal_x, goal_y, dx_goal, dy_goal, cross_norm,
                        );
                        self.heap_push(neighbor_local as u32, tentative_g + h + cross_tie_breaker);
                    }
                }
            }

            // Left
            if current_x > min_x {
                let neighbor_global = current_global - 1;
                let neighbor_local = current_local - 1;
                let neighbor_terrain = self.terrain[neighbor_global as usize];

                if self.closed_stamp[neighbor_local] != stamp
                    && (neighbor_global == goal || (neighbor_terrain & land_mask) == 0)
                {
                    let magnitude = neighbor_terrain & MAGNITUDE_MASK;
                    let cost = BASE_COST + get_magnitude_penalty(magnitude);
                    let tentative_g = current_g + cost;
                    let neighbor_x = current_x - 1;

                    if self.g_score_stamp[neighbor_local] != stamp
                        || tentative_g < self.g_score[neighbor_local]
                    {
                        self.came_from[neighbor_local] = current_local as i32;
                        self.g_score[neighbor_local] = tentative_g;
                        self.g_score_stamp[neighbor_local] = stamp;

                        let dist_to_goal =
                            abs_diff(neighbor_x, goal_x) + abs_diff(current_y, goal_y);
                        let h = weight * BASE_COST * dist_to_goal;
                        let cross_tie_breaker = cross_product_tie_breaker(
                            neighbor_x, current_y, goal_x, goal_y, dx_goal, dy_goal, cross_norm,
                        );
                        self.heap_push(neighbor_local as u32, tentative_g + h + cross_tie_breaker);
                    }
                }
            }

            // Right
            if current_x < max_x {
                let neighbor_global = current_global + 1;
                let neighbor_local = current_local + 1;
                let neighbor_terrain = self.terrain[neighbor_global as usize];

                if self.closed_stamp[neighbor_local] != stamp
                    && (neighbor_global == goal || (neighbor_terrain & land_mask) == 0)
                {
                    let magnitude = neighbor_terrain & MAGNITUDE_MASK;
                    let cost = BASE_COST + get_magnitude_penalty(magnitude);
                    let tentative_g = current_g + cost;
                    let neighbor_x = current_x + 1;

                    if self.g_score_stamp[neighbor_local] != stamp
                        || tentative_g < self.g_score[neighbor_local]
                    {
                        self.came_from[neighbor_local] = current_local as i32;
                        self.g_score[neighbor_local] = tentative_g;
                        self.g_score_stamp[neighbor_local] = stamp;

                        let dist_to_goal =
                            abs_diff(neighbor_x, goal_x) + abs_diff(current_y, goal_y);
                        let h = weight * BASE_COST * dist_to_goal;
                        let cross_tie_breaker = cross_product_tie_breaker(
                            neighbor_x, current_y, goal_x, goal_y, dx_goal, dy_goal, cross_norm,
                        );
                        self.heap_push(neighbor_local as u32, tentative_g + h + cross_tie_breaker);
                    }
                }
            }
        }

        None
    }

    fn build_path(
        &self,
        goal_local: u32,
        min_x: u32,
        min_y: u32,
        bounds_width: u32,
        map_width: u32,
        max_path_length: usize,
    ) -> Vec<u32> {
        let mut path = Vec::new();
        let mut current = goal_local as i32;

        let mut iterations = 0;
        while current != -1 && iterations < max_path_length {
            // Convert local to global
            let local_x = (current as u32) % bounds_width;
            let local_y = (current as u32) / bounds_width;
            let global = (local_y + min_y) * map_width + (local_x + min_x);
            path.push(global);

            current = self.came_from[current as usize];
            iterations += 1;
        }

        path.reverse();
        path
    }

    // Inline min-heap implementation for better performance
    #[inline(always)]
    fn heap_push(&mut self, node: u32, priority: u32) {
        let mut i = self.heap_size;
        self.heap_nodes[i] = node;
        self.heap_priorities[i] = priority;
        self.heap_size += 1;

        // Bubble up
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.heap_priorities[parent] <= self.heap_priorities[i] {
                break;
            }
            self.heap_nodes.swap(parent, i);
            self.heap_priorities.swap(parent, i);
            i = parent;
        }
    }

    #[inline(always)]
    fn heap_pop(&mut self) -> u32 {
        let result = self.heap_nodes[0];
        self.heap_size -= 1;

        if self.heap_size > 0 {
            self.heap_nodes[0] = self.heap_nodes[self.heap_size];
            self.heap_priorities[0] = self.heap_priorities[self.heap_size];

            // Bubble down
            let mut i = 0;
            loop {
                let left = (i << 1) + 1;
                let right = left + 1;
                let mut smallest = i;

                if left < self.heap_size
                    && self.heap_priorities[left] < self.heap_priorities[smallest]
                {
                    smallest = left;
                }
                if right < self.heap_size
                    && self.heap_priorities[right] < self.heap_priorities[smallest]
                {
                    smallest = right;
                }
                if smallest == i {
                    break;
                }

                self.heap_nodes.swap(smallest, i);
                self.heap_priorities.swap(smallest, i);
                i = smallest;
            }
        }
        result
    }
}

/// Absolute difference between two unsigned integers
#[inline(always)]
fn abs_diff(a: u32, b: u32) -> u32 {
    if a > b {
        a - b
    } else {
        b - a
    }
}

/// Cross-product tie-breaker: measures deviation from start-goal line
#[inline(always)]
fn cross_product_tie_breaker(
    nx: u32,
    ny: u32,
    goal_x: u32,
    goal_y: u32,
    dx_goal: i32,
    dy_goal: i32,
    cross_norm: u32,
) -> u32 {
    let dx_n = nx as i32 - goal_x as i32;
    let dy_n = ny as i32 - goal_y as i32;
    let cross = (dx_goal * dy_n - dy_goal * dx_n).unsigned_abs();
    (cross * (COST_SCALE - 1)) / (cross_norm * cross_norm)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_simple_water_map(width: u32, height: u32) -> Vec<u8> {
        // Create a simple map where everything is water (magnitude 5)
        vec![5u8; (width * height) as usize]
    }

    #[test]
    fn test_simple_bounded_path() {
        let width = 100;
        let height = 100;
        let terrain = create_simple_water_map(width, height);
        let max_search_area = 50 * 50; // 50x50 cluster

        let mut pathfinder =
            AStarWaterBounded::new(&terrain, width, height, max_search_area, None, None);

        // Find path within bounds
        let start = 10 * width + 10; // (10, 10)
        let goal = 40 * width + 40; // (40, 40)
        let path = pathfinder.search_bounded_js(start, goal, 0, 49, 0, 49);

        assert!(path.is_some());
        let path = path.unwrap();
        assert_eq!(*path.first().unwrap(), start);
        assert_eq!(*path.last().unwrap(), goal);
    }

    #[test]
    fn test_path_with_land_obstacle() {
        let width = 20;
        let height = 20;
        let mut terrain = create_simple_water_map(width, height);

        // Create a wall of land in the middle (x=10)
        let land_value = 5 | (1 << LAND_BIT);
        for y in 0..height {
            if y != 10 {
                // Leave a gap at y=10
                terrain[(y * width + 10) as usize] = land_value;
            }
        }

        let max_search_area = 20 * 20;
        let mut pathfinder =
            AStarWaterBounded::new(&terrain, width, height, max_search_area, None, None);

        // Path from (5, 5) to (15, 5) - must go around obstacle
        let start = 5 * width + 5;
        let goal = 5 * width + 15;
        let path = pathfinder.search_bounded_js(start, goal, 0, 19, 0, 19);

        assert!(path.is_some());
        let path = path.unwrap();
        assert_eq!(*path.first().unwrap(), start);
        assert_eq!(*path.last().unwrap(), goal);
        // Path should be longer than Manhattan distance due to obstacle
        assert!(path.len() > 11);
    }
}
