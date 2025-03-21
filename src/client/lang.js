document.addEventListener("DOMContentLoaded", async function () {
  const defaultLang = navigator.language.startsWith("ja") ? "ja" : "en";
  const userLang = localStorage.getItem("lang") || defaultLang;

  async function loadLanguage(lang) {
    try {
      const response = await fetch(`/lang/${lang}.json`);
      if (!response.ok) throw new Error(`Language file not found: ${lang}`);
      return await response.json();
    } catch (error) {
      console.error("🚨 Translation load error:", error);
      return {};
    }
  }

  function applyTranslation(translations) {
    document.title = translations.main?.title || document.title;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      const keys = key.split(".");
      let text = translations;

      for (const k of keys) {
        text = text?.[k];
        if (!text) break;
      }

      if (text) {
        element.innerHTML = text;
      } else {
        console.warn(`Missing translation key: ${key}`);
      }
    });
  }

  async function changeLanguage(lang) {
    // console.log(`Changing language to: ${lang}`);
    localStorage.setItem("lang", lang);
    const translations = await loadLanguage(lang);
    applyTranslation(translations);
  }

  const translations = await loadLanguage(userLang);
  applyTranslation(translations);

  const langSelector = document.getElementById("lang-selector");
  if (langSelector) {
    langSelector.value = userLang;
  }

  document
    .getElementById("lang-selector")
    .addEventListener("change", function (event) {
      changeLanguage(event.target.value);
    });
});
