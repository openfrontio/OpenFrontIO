export function initLayout() {
  const hb = document.getElementById("hamburger-btn");
  const sidebar = document.getElementById("sidebar-menu");
  const backdrop = document.getElementById("mobile-menu-backdrop");

  if (!hb || !sidebar || !backdrop) return;

  const setMenuState = (open: boolean) => {
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    document.documentElement.classList.toggle("overflow-hidden", open);
    hb.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const closeMenu = () => setMenuState(false);
  const openMenu = () => setMenuState(true);

  hb.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !sidebar.classList.contains("open");
    if (opening) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  backdrop.addEventListener("click", closeMenu);

  // Close menu when clicking a menu link (Mobile only)
  sidebar.addEventListener("click", (e) => {
    // On desktop, we want the menu to stay open unless explicitly toggled
    if (window.innerWidth >= 768) return;

    const target = e.target as HTMLElement;
    if (target && target.classList.contains("nav-menu-item")) {
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
}
