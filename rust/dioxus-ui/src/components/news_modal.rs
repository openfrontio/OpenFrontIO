//! NewsModal component
//!
//! A modal that displays the changelog/news as rendered HTML content.
//! The markdown is fetched and converted to HTML by the TypeScript bridge,
//! then passed to this component for rendering.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::CustomEventInit;

/// Register the news modal component
pub fn register() {
    log::debug!("Registered <dioxus-news-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<NewsModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static CONTENT_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct NewsModalState {
    translations: NewsModalTranslations,
    content_html: String,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsModalTranslations {
    pub title: String,
    pub back: String,
    pub loading: String,
}

/// NewsModal component props
#[derive(Props, Clone, PartialEq)]
pub struct NewsModalProps {
    pub translations: NewsModalTranslations,
    pub initial_content_html: String,
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);

    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict("dioxus-modal-close", &init) {
        if let Some(root) = document.get_element_by_id("dioxus-news-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main NewsModal component
#[component]
pub fn NewsModal(props: NewsModalProps) -> Element {
    let is_open = use_signal(|| false);
    let initial_content_html = props.initial_content_html.clone();
    let content_html = use_signal(move || initial_content_html);

    // Store signals for external updates
    IS_OPEN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_open));
    CONTENT_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(content_html));

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! { div { class: "hidden" } };
    }

    let has_content = !content_html().is_empty();

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]",
            onclick: on_close,
        }
        // Modal
        div {
            class: "fixed inset-4 md:inset-8 lg:inset-16 z-[9999] flex items-center justify-center pointer-events-none",
            div {
                class: "w-full max-w-4xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col",
                onclick: |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center gap-3 p-4 border-b border-white/10 shrink-0",
                    button {
                        class: "w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors",
                        onclick: on_close,
                        "aria-label": "{props.translations.back}",
                        svg {
                            xmlns: "http://www.w3.org/2000/svg",
                            fill: "none",
                            "viewBox": "0 0 24 24",
                            "stroke-width": "2",
                            stroke: "currentColor",
                            class: "w-5 h-5 text-white",
                            path {
                                "stroke-linecap": "round",
                                "stroke-linejoin": "round",
                                d: "M15.75 19.5L8.25 12l7.5-7.5"
                            }
                        }
                    }
                    h2 {
                        class: "text-xl font-bold text-white",
                        "{props.translations.title}"
                    }
                }

                // Content
                div {
                    class: "prose prose-invert prose-sm max-w-none overflow-y-auto px-6 py-3 mr-1
                        [&_a]:text-blue-400 [&_a:hover]:text-blue-300 transition-colors
                        [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
                        [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
                        [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
                        [&_ul]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1
                        [&_li]:text-gray-300 [&_li]:leading-relaxed
                        [&_p]:text-gray-300 [&_p]:mb-3 [&_strong]:text-white [&_strong]:font-bold
                        scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent",

                    if has_content {
                        div {
                            dangerous_inner_html: "{content_html()}"
                        }
                    } else {
                        p {
                            class: "text-white/60 animate-pulse",
                            "{props.translations.loading}"
                        }
                    }
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn NewsModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            NewsModal {
                translations: state.translations,
                initial_content_html: state.content_html,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the news modal component
pub fn launch_news_modal(translations_json: &str) {
    log::info!("Launching news modal");

    let translations: NewsModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    MODAL_STATE.with(|s| {
        let previous_content = s
            .borrow()
            .as_ref()
            .map(|state| state.content_html.clone())
            .unwrap_or_default();

        *s.borrow_mut() = Some(NewsModalState {
            translations,
            content_html: previous_content,
        });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-news-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(NewsModalRoot);
}

/// Open the modal
pub fn open_news_modal() {
    log::debug!("open_news_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening news modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_news_modal() {
    log::debug!("close_news_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing news modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}

/// Update the content HTML
pub fn update_news_modal_content(html: &str) {
    MODAL_STATE.with(|s| {
        if let Some(state) = s.borrow_mut().as_mut() {
            state.content_html = html.to_string();
        }
    });

    CONTENT_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}
