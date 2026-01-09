export function initNavigation() {
  const showPage = (pageId: string) => {
    // Hide all pages
    document.querySelectorAll(".page-content").forEach((el) => {
      el.classList.add("hidden");
      el.classList.remove("block");
    });
    document.getElementById("page-play")?.classList.add("hidden");

    const target = document.getElementById(pageId);
    if (target) {
      target.classList.remove("hidden");
      // Modals need block display explicitly
      if (target.classList.contains("page-content")) {
        target.classList.add("block");
      }

      // If the target itself is a modal component with inline attribute, open it
      if (
        target.hasAttribute("inline") &&
        typeof (target as any).open === "function"
      ) {
        (target as any).open();
      }
    }

    // Update active state on menu items
    document.querySelectorAll(".nav-menu-item").forEach((item) => {
      if ((item as HTMLElement).dataset.page === pageId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // Dispatch CustomEvent to notify listeners of page change
    window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
  };

  window.showPage = showPage;

  document.querySelectorAll(".nav-menu-item[data-page]").forEach((el) => {
    el.addEventListener("click", () => {
      const pageId = (el as HTMLElement).dataset.page;
      if (pageId) showPage(pageId);
    });
  });

  // Handle clicks on main container to close open modals (navigate back)
  const mainEl = document.querySelector("main");
  if (mainEl) {
    mainEl.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      const isPlayPageHidden = document
        .getElementById("page-play")
        ?.classList.contains("hidden");

      // Only proceed if we are NOT on the play page (meaning a modal page is open)
      if (isPlayPageHidden) {
        // If clicking on the main container directly (e.g. padding/background)
        // or the max-width wrapper div directly
        const wrapper = mainEl.firstElementChild as HTMLElement;
        if (target === mainEl || (wrapper && target === wrapper)) {
          showPage("page-play");
        }
      }
    });
  }

  // Set default active if not set
  const initialPage = document.querySelector(
    '.nav-menu-item[data-page="page-play"]',
  );
  if (initialPage && !initialPage.classList.contains("active")) {
    showPage("page-play");
  }
}
