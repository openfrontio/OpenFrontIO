declare global {
  interface Window {
    showPage: (pageId: string) => void;
  }
}

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
  };

  window.showPage = showPage;

  document.querySelectorAll(".nav-menu-item[data-page]").forEach((el) => {
    el.addEventListener("click", () => {
      const pageId = (el as HTMLElement).dataset.page;
      if (pageId) showPage(pageId);
    });
  });

  // Set default active if not set
  const initialPage = document.querySelector(
    '.nav-menu-item[data-page="page-play"]',
  );
  if (initialPage && !initialPage.classList.contains("active")) {
    initialPage.classList.add("active");
  }
}
