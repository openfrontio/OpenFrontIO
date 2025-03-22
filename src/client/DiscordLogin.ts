async function updateAuthButton() {
  try {
    const response = await fetch('/api/auth/status');
    const data = await response.json();
    const authBtn = document.getElementById('auth-btn');

    if (!authBtn) {
      console.error("Auth button not found in the document.");
      return;
    }

    if (data.loggedIn) {
      authBtn.textContent = 'Logout';
      authBtn.onclick = () => {
        window.location.href = '/logout';
      };
    } else {
      authBtn.textContent = 'Login with Discord';
      authBtn.onclick = () => {
        window.location.href = '/auth/discord';
      };
    }
  } catch (err) {
    console.error("Failed to fetch auth status", err);
  }
}

document.addEventListener("DOMContentLoaded", updateAuthButton);
