// /src/client/auth.js

window.addEventListener('DOMContentLoaded', () => {
  
    fetch('/api/auth/status')
      .then(response => response.json())
      .then(data => {
        const authButton = document.getElementById('auth-button');
        const buttonText = document.getElementById('button-text');
        if (data.loggedIn) {
          
          buttonText.textContent = 'Logout';
          
          authButton.href = '/auth/logout';
        } else {
          
          buttonText.textContent = 'Login with Discord';
          
        }
      })
      .catch(console.error);
  });
  
