//! MobileNavBar component
//!
//! The sidebar navigation menu for mobile/tablet screens.
//! Contains:
//! - OpenFront logo + version text
//! - Vertical navigation buttons (Play, News, Stats, Store, Settings, Account, Help)
//! - Language selector slot at the bottom

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::JsValue;
use web_sys::{CustomEvent, CustomEventInit};

thread_local! {
    static STATE: RefCell<Option<Signal<MobileNavBarState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileNavItem {
    page_id: String,
    label: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileNavBarState {
    is_visible: bool,
    game_version: String,
    active_page: String,
    nav_items: Vec<MobileNavItem>,
}

pub fn register() {
    log::debug!("Registered <dioxus-mobile-nav-bar> component");
}

fn emit_nav_event(page_id: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            init.set_detail(&JsValue::from_str(page_id));
            if let Ok(event) = CustomEvent::new_with_event_init_dict("dioxus-nav-click", &init) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// OpenFront logo SVG path data (same as desktop)
const LOGO_PATH_OUTER: &str = "M0,174V51h15.24v-17.14h16.81v-16.98h16.96V0h1266v17.23h17.13v16.81h16.98v16.96h14.88v123h-15.13v17.08h-17.08v17.08h-16.9v17.04H324.9v16.86h-16.9v16.95h-102v-17.12h-17.07v-17.05H48.73v-17.05h-16.89v-16.89H14.94v-16.89H0ZM1297.95,17.35H65.9v16.7h-17.08v17.08h-14.5v123.08h14.85v16.9h17.08v17.08h139.9v17.08h17.08v16.36h67.9v-16.72h17.08v-17.07h989.88v-17.07h17.08v-16.9h14.44V50.8h-14.75v-17.08h-16.9v-16.37Z";
const LOGO_PATH_O: &str = "M189.1,154.78v17.07h-16.9v16.75h-51.07v-16.42h-16.9v-17.07h-16.97v-84.88h16.63v-17.07h16.9v-16.84h51.07v16.5h17.07v17.07h16.7v84.89h-16.54ZM137.87,53.1v17.15h-16.6v84.86h16.97v16.61h16.89v-16.97h16.6v-84.86h-16.97v-16.79h-16.89Z";
const LOGO_PATH_P: &str = "M273.91,104.06v-16.73h50.92v16.45h16.85v68.05h-16.44v17.06h-50.96v16.88h16.4v16.96h-67.28v-16.61h16.33v-101.86h-16.38v-16.98h33.4v16.63c6.12,0,11.72,0,17.31,0,0,22.56,0,45.13,0,67.75h33.59v-67.61h-33.73Z";
const LOGO_PATH_F: &str = "M631.12,188.64v-16.36h16.53V53.2h-16.25v-16.86h118.33v33.29h-16.65v-16.36h-50.72v50.44h33.36v-16.35h16.99v50.25h-16.6v-16.33h-33.73v50.65h16.37v16.72h-67.63Z";
const LOGO_PATH_E: &str = "M460.77,155.38v16.49h-16.58v16.83h-68.05v-16.5h-16.83v-68.05h16.49v-16.83h68.05v16.49h16.83v34.06h-67.31v33.82h33.47v-16.31h33.92ZM393.39,104.18v16.56h33.3v-16.56h-33.3Z";
const LOGO_PATH_N1: &str =
    "M596.78,103.8v84.94h-33.54v-84.39h-34.03v84.25h-33.85v-101.29h84.5v16.49h16.93Z";
const LOGO_PATH_N2: &str =
    "M1107.12,188.71v-84.34h-34.03v84.37h-33.7v-101.41h84.42v16.41h16.86v84.96h-33.54Z";
const LOGO_PATH_O2: &str = "M988.1,171.78v16.87h-67.88v-16.38h-16.87v-68.06h16.38v-16.87h68.06v16.38h16.87v68.06h-16.55ZM970.78,104.35h-33.39v67.38h33.39v-67.38Z";
const LOGO_PATH_T: &str = "M1209.13,172h-16.9v-67.9h-16.96v-16.9h16.68v-17.08h16.9v-16.82h16.9v33.58h50.98v16.91h-50.4v67.96h16.48v-16.43h50.95v16.54h-16.55v16.76h-68.08v-16.6Z";
const LOGO_PATH_R1: &str = "M834.91,120.94v16.96h-16.65v33.88h16.41v16.96h-67.29v-16.63h16.34v-67.87h-16.4v-16.97h50.42v33.81h17.3l-.14-.14Z";
const LOGO_PATH_R2: &str = "M835.05,121.08v-33.75h33.76v16.43h16.85v33.96h-33.43v-16.79c-6.13,0-11.73,0-17.32,0,0,0,.14.14.14.14Z";

#[component]
fn MobileNavBar() -> Element {
    let state = use_signal(MobileNavBarState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let current = state();

    if !current.is_visible {
        return rsx! {};
    }

    rsx! {
        // Border segments (decorative)
        div {
            class: "absolute right-0 top-0 w-px bg-transparent",
            style: "height: calc(50% - 64px)",
        }
        div {
            class: "absolute right-0 bottom-0 w-px bg-transparent",
            style: "height: calc(50% - 64px)",
        }

        div {
            class: "flex-1 w-full flex flex-col justify-start overflow-y-auto md:pt-[clamp(1rem,3vh,4rem)] md:pb-[clamp(0.5rem,2vh,2rem)] md:px-[clamp(1rem,1.5vw,2rem)] p-5 gap-[clamp(1rem,3vh,3rem)]",

            // Logo + version
            div {
                class: "flex flex-col text-[#2563eb] mb-[clamp(1rem,2vh,2rem)] ml-[clamp(0.2rem,0.4vw,0.4vh)]",
                div {
                    class: "flex flex-col items-center gap-2",
                    svg {
                        xmlns: "http://www.w3.org/2000/svg",
                        view_box: "0 0 1364 259",
                        width: "100%",
                        height: "100%",
                        fill: "currentColor",
                        class: "w-[clamp(120px,15vw,192px)] h-[clamp(40px,6vh,64px)] drop-shadow-[0_0_10px_rgba(37,99,235,0.3)]",
                        path { d: LOGO_PATH_OUTER }
                        path { d: LOGO_PATH_O }
                        path { d: LOGO_PATH_P }
                        path { d: LOGO_PATH_F }
                        path { d: LOGO_PATH_E }
                        path { d: LOGO_PATH_N1 }
                        path { d: LOGO_PATH_N2 }
                        path { d: LOGO_PATH_O2 }
                        path { d: LOGO_PATH_T }
                        path { d: LOGO_PATH_R1 }
                        path { d: LOGO_PATH_R2 }
                    }
                    div {
                        id: "game-version",
                        class: "l-header__highlightText text-center",
                        "{current.game_version}"
                    }
                }
            }

            // Navigation items
            for item in current.nav_items.iter() {
                {
                    let page_id = item.page_id.clone();
                    let is_active = item.page_id == current.active_page;
                    let active_class = if is_active {
                        " text-blue-600 translate-x-2.5 drop-shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                    } else {
                        ""
                    };
                    rsx! {
                        button {
                            class: "nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]{active_class}",
                            "data-page": "{item.page_id}",
                            onclick: move |_| emit_nav_event(&page_id),
                            "{item.label}"
                        }
                    }
                }
            }

            // Language selector slot at bottom
            div {
                class: "flex flex-col w-full mt-auto items-end justify-end pt-4 border-t border-white/10",
                div { id: "dioxus-mobile-nav-lang-selector-slot" }
            }
        }
    }
}

fn MobileNavBarRoot() -> Element {
    rsx! { MobileNavBar {} }
}

pub fn launch_mobile_nav_bar() {
    log::info!("Launching mobile nav bar");
    let config = dioxus::web::Config::new().rootname("dioxus-mobile-nav-bar-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(MobileNavBarRoot);
}

pub fn update_mobile_nav_bar(state_json: &str) {
    let new_state: MobileNavBarState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse mobile nav bar state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
