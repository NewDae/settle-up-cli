const panels = { human: document.getElementById('human-view'), machine: document.getElementById('machine-view') };
const audienceLinks = [...document.querySelectorAll('[data-audience]')];
const guideUrl = 'https://settleupcli.pages.dev/agent.md';
function agentPrompt(agent) {
  const greeting = agent ? `Hi ${agent}, ` : '';
  return `${greeting}help me connect my Settle Up account so you can help with shared expenses and balances. Read ${guideUrl} and follow the setup guide. Check whether you have the tools to run the CLI, then run settleup auth login --browser and give me the private login link. After I sign in on that page, run settleup auth login --complete. This CLI uses email/password; if I need to migrate, direct me to https://settleup.app/migrate-account. Never ask for my password or tokens in chat. Once connected, show me my groups. Make no changes to expenses or groups until I ask.`;
}
document.getElementById('prompt-preview-text').textContent = agentPrompt();
function showAudience(audience, updateUrl = true) {
  const selected = audience === 'machine' ? 'machine' : 'human';
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== selected;
  for (const link of audienceLinks) {
    if (link.dataset.audience === selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (updateUrl) {
    const url = new URL(location.href);
    if (selected === 'machine') url.searchParams.set('view', 'machine');
    else url.searchParams.delete('view');
    history.replaceState(null, '', url);
  }
}
for (const link of audienceLinks) link.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  showAudience(link.dataset.audience);
});
showAudience(new URL(location.href).searchParams.get('view'), false);
window.addEventListener('popstate', () => showAudience(new URL(location.href).searchParams.get('view'), false));
for (const button of document.querySelectorAll('.copy-prompt')) {
  const original = button.innerHTML;
  button.addEventListener('click', async () => {
    const prompt = agentPrompt(button.dataset.agent);
    document.getElementById('prompt-preview-text').textContent = prompt;
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(prompt);
      document.getElementById('copy-fallback').hidden = true;
      status.textContent = `Prompt copied. Paste it into your ${button.dataset.agent || 'agent'} conversation.`;
      button.textContent = 'Copied ✓';
      window.setTimeout(() => { button.innerHTML = original; }, 2200);
    } catch {
      document.getElementById('fallback-prompt').value = prompt;
      document.getElementById('copy-fallback').hidden = false;
      status.textContent = 'Select and copy the prompt below.';
      document.getElementById('fallback-prompt').focus();
      document.getElementById('fallback-prompt').select();
    }
  });
}
