use wasm_bindgen::prelude::*;
use pathfinding::prelude::astar;
use js_sys::Array;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Point {
    pub x: u32,
    pub y: u32,
}

#[wasm_bindgen]
pub fn get_vec_len(data: Array) -> usize {
    let mut vec_data = Vec::new();
    for i in 0..data.length() {
        let val = data.get(i).as_f64().unwrap() as u8;
        vec_data.push(val);
    }
    vec_data.len()
}

#[wasm_bindgen]
pub fn find_path(
    start_x: u32,
    start_y: u32,
    end_x: u32,
    end_y: u32,
    width: u32,
    height: u32,
    grid_data: Array,
) -> Option<Array> {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    let mut rust_grid_data = Vec::new();
    for i in 0..grid_data.length() {
        let val = grid_data.get(i).as_f64().unwrap() as u8;
        rust_grid_data.push(val);
    }

    let start = Point { x: start_x, y: start_y };
    let end = Point { x: end_x, y: end_y };

    log(&format!("find_path called: start=({},{}) end=({},{}) width={} height={} grid_data.len()={}", start_x, start_y, end_x, end_y, width, height, rust_grid_data.len()));

    let result = astar(
        &start,
        |p| {
            let mut successors = Vec::new();
            let x = p.x;
            let y = p.y;

            if x > 0 {
                successors.push(Point { x: x - 1, y });
            }
            if x < width - 1 {
                successors.push(Point { x: x + 1, y });
            }
            if y > 0 {
                successors.push(Point { x, y: y - 1 });
            }
            if y < height - 1 {
                successors.push(Point { x, y: y + 1 });
            }

            successors
                .into_iter()
                .filter_map(|p| {
                    let index = (p.y * width + p.x) as usize;
                    if index >= rust_grid_data.len() {
                        log(&format!("Index out of bounds: p=({},{}) index={} grid_data.len()={}", p.x, p.y, index, rust_grid_data.len()));
                        None
                    } else if rust_grid_data[index] == 0 {
                        Some((p, 1))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        },
        |p| ((p.x as i32 - end.x as i32).abs() + (p.y as i32 - end.y as i32).abs()) as u32,
        |p| *p == end,
    );

    result.map(|(path, _cost)| {
        let js_array = Array::new();
        for p in path {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &JsValue::from_str("x"), &JsValue::from_f64(p.x as f64)).unwrap();
            js_sys::Reflect::set(&obj, &JsValue::from_str("y"), &JsValue::from_f64(p.y as f64)).unwrap();
            js_array.push(&obj);
        }
        js_array
    })
}