export function initLayout() {
  const hb = document.getElementById("hamburger-btn");
  const sidebar = document.getElementById("sidebar-menu");
  const backdrop = document.getElementById("mobile-menu-backdrop");

  // Force sidebar visibility style to ensure it's not hidden by other CSS
  if (sidebar && window.innerWidth < 768) {
      sidebar.style.display = 'flex';
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
    console.log("initLayout: setMenuState ->", open);
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    document.documentElement.classList.toggle("overflow-hidden", open);
    hb.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) attachMenuItemListeners();
    else detachMenuItemListeners();
  };

  const closeMenu = () => setMenuState(false);
  const openMenu = () => setMenuState(true);

  // Track attached listeners so we can remove them later
  const attachedMenuListeners: Array<{
    el: Element;
    handler: EventListenerOrEventListenerObject;
  }> = [];

  const attachMenuItemListeners = () => {
    try {
      const items = sidebar.querySelectorAll('.nav-menu-item, a[data-page], button');
      items.forEach((el) => {
        // avoid duplicate
        if ((el as any).__menuListenerAttached) return;
        const fn = (ev: Event) => {
          if (window.innerWidth >= 768) return;
          try {
            closeMenu();
          } catch (err) {
            console.error('menu item close handler failed', err);
          }
        };
        el.addEventListener('click', fn, { passive: true });
        (el as any).__menuListenerAttached = true;
        attachedMenuListeners.push({ el, handler: fn });
      });
    } catch (err) {
      console.error('attachMenuItemListeners error', err);
    }
  };

  const detachMenuItemListeners = () => {
    try {
      attachedMenuListeners.forEach(({ el, handler }) => {
        try {
          el.removeEventListener('click', handler as EventListener);
          (el as any).__menuListenerAttached = false;
        } catch (e) {
          // ignore
        }
      });
    } catch (err) {
      console.error('detachMenuItemListeners error', err);
    }
    attachedMenuListeners.length = 0;
  };

  const toggle = (e: Event) => {
    console.log("initLayout: hamburger toggle event", e.type);
    e.stopPropagation();
    // Only prevent default if it's a touchstart to avoid ghost clicks
    if ((e as any).type === "touchstart") {
      (e as Event).preventDefault();
    }

    const opening = !sidebar.classList.contains("open");
    console.log("initLayout: sidebar open before toggle?", sidebar.classList.contains("open"));
    if (opening) {
      openMenu();
    } else {
      closeMenu();
    }
  };

  hb.addEventListener("click", toggle);
  // hb.addEventListener("touchstart", toggle, { passive: false });

  backdrop.addEventListener("click", closeMenu);

  // Close menu when clicking a menu link or button (Mobile only)
  sidebar.addEventListener("click", (e) => {
    // On desktop, we want the menu to stay open unless explicitly toggled
    if (window.innerWidth >= 768) return;

    // If the click happened on or inside an anchor/button/menu item, close the menu
    const clickedElement = (e.target as Element).closest
      ? (e.target as Element).closest('a, button, [role="menuitem"]')
      : null;

    if (clickedElement) {
      console.log('initLayout: sidebar menu item clicked, closing menu');
      closeMenu();
    }
  });

  // Add a capture-phase listener to catch clicks before other handlers stop propagation
  sidebar.addEventListener(
    "click",
    (e) => {
      if (window.innerWidth >= 768) return;
      const tgt = e.target as Element;
      if (tgt && tgt.closest && tgt.closest('a, button, [role="menuitem"]')) {
        console.log('initLayout (capture): menu item clicked, closing');
        closeMenu();
      }
    },
    true
  );

  // Also attach direct listeners to known menu items to be extra reliable
  const menuItems = sidebar.querySelectorAll('.nav-menu-item, a, button, [role="menuitem"]');
  menuItems.forEach((el) => {
    el.addEventListener(
      'click',
      (ev) => {
        if (window.innerWidth >= 768) return;
        console.log('initLayout: direct menu-item listener triggered, closing');
        closeMenu();
      },
      { passive: true }
    );
  });

  // Close on Escape (Mobile only)
  document.addEventListener("keydown", (e) => {
    if (window.innerWidth >= 768) return;
    if (e.key === "Escape" && sidebar.classList.contains("open")) {
      closeMenu();
    }
  });
}
