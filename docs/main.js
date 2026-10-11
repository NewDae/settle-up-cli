const panels = { human: document.getElementById('human-view'), machine: document.getElementById('machine-view') };
const radios = [...document.querySelectorAll('input[name="audience"]')];
function showAudience(audience, updateUrl = true) {
  const selected = audience === 'machine' ? 'machine' : 'human';
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== selected;
  for (const radio of radios) radio.checked = radio.value === selected;
  document.getElementById('copy-status').textContent = '';
  if (updateUrl) {
    const url = new URL(location.href);
    if (selected === 'machine') url.searchParams.set('view', 'machine');
    else url.searchParams.delete('view');
    history.replaceState(null, '', url);
  }
}
for (const radio of radios) radio.addEventListener('change', () => showAudience(radio.value));
showAudience(new URL(location.href).searchParams.get('view'), false);
window.addEventListener('popstate', () => showAudience(new URL(location.href).searchParams.get('view'), false));
for (const button of document.querySelectorAll('.copy-command')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      document.getElementById('copy-status').textContent = 'Install command copied.';
      window.setTimeout(() => { button.textContent = 'Copy install command'; }, 2500);
    } catch {
      document.getElementById('copy-status').textContent = 'Select and copy: ' + button.dataset.copy;
    }
  });
}
