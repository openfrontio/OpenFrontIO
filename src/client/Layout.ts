export function initLayout() {
  // Wait for play-page component to render before setting up hamburger menu
  customElements.whenDefined("play-page").then(() => {
    const hb = document.getElementById("hamburger-btn");
    const sidebar = document.getElementById("sidebar-menu");
    const backdrop = document.getElementById("mobile-menu-backdrop");

    // Force sidebar visibility style to ensure it's not hidden by other CSS
    if (sidebar && window.innerWidth < 768) {
      sidebar.style.display = "flex";
    }

    if (!hb) {
      console.error("Hamburger button not found");
      return;
    }

    // Disable fallback inline handler now that JS is loaded
    hb.onclick = null;

    if (!sidebar) {
      console.error("Sidebar menu not found");
      return;
    }
    if (!backdrop) {
      console.error("Mobile menu backdrop not found");
      return;
    }

    const setMenuState = (open: boolean) => {
      sidebar.classList.toggle("open", open);
      backdrop.classList.toggle("open", open);
      document.documentElement.classList.toggle("overflow-hidden", open);
      hb.setAttribute("aria-expanded", open ? "true" : "false");
    };

    const closeMenu = () => setMenuState(false);
    const openMenu = () => setMenuState(true);

    const toggle = (e: Event) => {
      e.stopPropagation();
      // Only prevent default if it's a touchstart to avoid ghost clicks
      if ((e as any).type === "touchstart") {
        (e as Event).preventDefault();
      }

      const opening = !sidebar.classList.contains("open");
      if (opening) {
        openMenu();
      } else {
        closeMenu();
      }
    };

    hb.addEventListener("click", toggle);

    backdrop.addEventListener("click", closeMenu);

    // Close menu when clicking a menu link or button (Mobile only)
    sidebar.addEventListener("click", (e) => {
      // On desktop, we want the menu to stay open unless explicitly toggled
      if (window.innerWidth >= 768) return;

      // If the click happened on or inside an anchor/button/menu item, close the menu
      const clickedElement = (e.target as Element).closest
        ? (e.target as Element).closest(
            'a, button, [role="menuitem"], .nav-menu-item',
          )
        : null;

      if (clickedElement) {
        closeMenu();
      }
    });

    // Close on Escape (Mobile only)
    document.addEventListener("keydown", (e) => {
      if (window.innerWidth >= 768) return;
      if (e.key === "Escape" && sidebar.classList.contains("open")) {
        closeMenu();
      }
    });
  });
}
