const installButton = document.getElementById('copy-install');
const status = document.getElementById('copy-status');
installButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('npm install -g settle-up-cli');
    installButton.textContent = 'Copied';
    status.textContent = 'Install command copied.';
    window.setTimeout(() => { installButton.textContent = 'Copy install command'; }, 2500);
  } catch {
    status.textContent = 'Select and copy: npm install -g settle-up-cli';
  }
});
