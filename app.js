const REQUEST_STORAGE_KEY = 'settledown-api-tester-request-v2';
const RESPONSE_STORAGE_KEY = 'settledown-api-tester-response-v2';
const ACTIVE_TAB_STORAGE_KEY = 'settledown-api-tester-active-tab-v2';

const PRESETS = [
  {
    id: 'firebase-signup',
    label: 'Firebase Sign Up',
    description: 'Creates a temporary sandbox email/password user and returns idToken, refreshToken, and uid.',
    request: {
      method: 'POST',
      url: 'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
      queryParams: [{ key: 'key', value: 'AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify(
        {
          email: 'codex@example.com',
          password: 'CodexTest123!',
          returnSecureToken: true,
        },
        null,
        2
      ),
    },
  },
  {
    id: 'firebase-signin',
    label: 'Firebase Sign In',
    description: 'Signs in an existing sandbox email/password user and returns a fresh idToken.',
    request: {
      method: 'POST',
      url: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
      queryParams: [{ key: 'key', value: 'AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify(
        {
          email: 'codex@example.com',
          password: 'CodexTest123!',
          returnSecureToken: true,
        },
        null,
        2
      ),
    },
  },
  {
    id: 'firebase-refresh-token',
    label: 'Firebase Refresh Token',
    description: 'Exchanges a refresh token for a new id_token through the Secure Token endpoint.',
    request: {
      method: 'POST',
      url: 'https://securetoken.googleapis.com/v1/token',
      queryParams: [{ key: 'key', value: 'AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/x-www-form-urlencoded', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'text',
      body: 'grant_type=refresh_token&refresh_token=PASTE_REFRESH_TOKEN_HERE',
    },
  },
  {
    id: 'firebase-lookup-user',
    label: 'Firebase Lookup User',
    description: 'Looks up the Firebase Auth user entity for a given idToken and returns localId, email, and provider state.',
    request: {
      method: 'POST',
      url: 'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
      queryParams: [{ key: 'key', value: 'AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify(
        {
          idToken: 'PASTE_ID_TOKEN_HERE',
        },
        null,
        2
      ),
    },
  },
  {
    id: 'read-user-record',
    label: 'GET /users/<uid>',
    description: 'Reads the sandbox app-level user record for a specific Firebase uid.',
    request: {
      method: 'GET',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [],
      bodyEnabled: false,
      bodyMode: 'json',
      body: '',
    },
  },
  {
    id: 'read-user-groups',
    label: 'GET /userGroups/<uid>',
    description: 'Reads the group membership map for a specific Firebase uid.',
    request: {
      method: 'GET',
      url: 'https://settle-up-sandbox.firebaseio.com/userGroups/PASTE_UID_HERE.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [],
      bodyEnabled: false,
      bodyMode: 'json',
      body: '',
    },
  },
  {
    id: 'write-current-tab',
    label: 'PUT /users/<uid>/currentTabId',
    description: 'Writes the documented currentTabId child field under a user record.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE/currentTabId.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify('NEW_GROUP'),
    },
  },
  {
    id: 'write-user-email',
    label: 'PUT /users/<uid>/email',
    description: 'Writes the email child field under a user record.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE/email.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify('codex@example.com'),
    },
  },
  {
    id: 'write-user-name',
    label: 'PUT /users/<uid>/name',
    description: 'Writes the display name child field under a user record.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE/name.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify('Codex Test'),
    },
  },
  {
    id: 'write-user-locale',
    label: 'PUT /users/<uid>/locale',
    description: 'Writes the locale child field under a user record.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE/locale.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify('en-us'),
    },
  },
  {
    id: 'write-auth-provider',
    label: 'PUT /users/<uid>/authProvider',
    description: 'Observed sandbox mismatch: this child write is currently denied for fresh REST-created users.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/users/PASTE_UID_HERE/authProvider.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify('password'),
    },
  },
  {
    id: 'create-group',
    label: 'POST /groups',
    description: 'Documented create-group flow. Observed sandbox mismatch: currently denied for fresh REST-created users.',
    request: {
      method: 'POST',
      url: 'https://settle-up-sandbox.firebaseio.com/groups.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify(
        {
          name: 'Codex Test Group',
          convertedToCurrency: 'USD',
          defaultPermission: 10,
          minimizeDebts: true,
          remindOldDebts: true,
        },
        null,
        2
      ),
    },
  },
  {
    id: 'put-permission',
    label: 'PUT /permissions/<groupId>/<uid>',
    description: 'Writes a permission level for a user under a synthetic or real group id.',
    request: {
      method: 'PUT',
      url: 'https://settle-up-sandbox.firebaseio.com/permissions/PASTE_GROUP_ID_HERE/PASTE_UID_HERE.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify({ level: 30 }, null, 2),
    },
  },
  {
    id: 'post-member',
    label: 'POST /members/<groupId>',
    description: 'Creates a member row under a given group id and returns the generated member key.',
    request: {
      method: 'POST',
      url: 'https://settle-up-sandbox.firebaseio.com/members/PASTE_GROUP_ID_HERE.json',
      queryParams: [{ key: 'auth', value: 'PASTE_ID_TOKEN_HERE', enabled: true }],
      headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
      bodyEnabled: true,
      bodyMode: 'json',
      body: JSON.stringify(
        {
          name: 'Codex',
          active: true,
          defaultWeight: '1',
          photoUrl: null,
          bankAccount: null,
          lightningAddress: null,
        },
        null,
        2
      ),
    },
  },
];

const defaultRequestState = {
  selectedPresetId: PRESETS[0].id,
  ...structuredClone(PRESETS[0].request),
};

const defaultResponseState = {
  status: 'Idle',
  duration: '--',
  size: '--',
  ok: null,
  body: 'No request sent yet.',
  headers: 'Headers will appear here.',
  request: 'Resolved request details will appear here.',
  summary: 'No request has been sent yet. The first response will stay here until another request completes.',
  lastUpdatedAt: null,
};

const state = {
  request: loadRequestState(),
  response: loadResponseState(),
  activeTab: loadActiveTab(),
  isSubmitting: false,
  composerStatus: 'Draft changes are saved locally as you type.',
  composerTone: 'neutral',
};

const elements = {
  methodInput: document.querySelector('#methodInput'),
  urlInput: document.querySelector('#urlInput'),
  queryParamsList: document.querySelector('#queryParamsList'),
  headersList: document.querySelector('#headersList'),
  addQueryParamButton: document.querySelector('#addQueryParamButton'),
  addHeaderButton: document.querySelector('#addHeaderButton'),
  bodyEnabledInput: document.querySelector('#bodyEnabledInput'),
  bodyModeInput: document.querySelector('#bodyModeInput'),
  bodyInput: document.querySelector('#bodyInput'),
  formatBodyButton: document.querySelector('#formatBodyButton'),
  sendRequestButton: document.querySelector('#sendRequestButton'),
  saveRequestButton: document.querySelector('#saveRequestButton'),
  resetRequestButton: document.querySelector('#resetRequestButton'),
  responseStatus: document.querySelector('#responseStatus'),
  responseDuration: document.querySelector('#responseDuration'),
  responseSize: document.querySelector('#responseSize'),
  responseBodyOutput: document.querySelector('#responseBodyOutput'),
  responseHeadersOutput: document.querySelector('#responseHeadersOutput'),
  resolvedRequestOutput: document.querySelector('#resolvedRequestOutput'),
  resolvedRequestPreview: document.querySelector('#resolvedRequestPreview'),
  copyActiveResponseButton: document.querySelector('#copyActiveResponseButton'),
  presetSelect: document.querySelector('#presetSelect'),
  applyPresetButton: document.querySelector('#applyPresetButton'),
  presetDescription: document.querySelector('#presetDescription'),
  responseSummary: document.querySelector('#responseSummary'),
  composerStatus: document.querySelector('#composerStatus'),
  requestStateBadge: document.querySelector('#requestStateBadge'),
  tabButtons: [...document.querySelectorAll('.tab-button')],
  tabPanels: [...document.querySelectorAll('.response-tab')],
  kvRowTemplate: document.querySelector('#kvRowTemplate'),
};

bindEvents();
render();

function loadRequestState() {
  try {
    const raw = localStorage.getItem(REQUEST_STORAGE_KEY);
    if (!raw) {
      return structuredClone(defaultRequestState);
    }

    return {
      ...structuredClone(defaultRequestState),
      ...JSON.parse(raw),
    };
  } catch {
    return structuredClone(defaultRequestState);
  }
}

function saveRequestState() {
  localStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify(state.request));
}

function loadResponseState() {
  try {
    const raw = localStorage.getItem(RESPONSE_STORAGE_KEY);
    if (!raw) {
      return structuredClone(defaultResponseState);
    }

    return {
      ...structuredClone(defaultResponseState),
      ...JSON.parse(raw),
    };
  } catch {
    return structuredClone(defaultResponseState);
  }
}

function saveResponseState() {
  localStorage.setItem(RESPONSE_STORAGE_KEY, JSON.stringify(state.response));
}

function loadActiveTab() {
  const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  return ['body', 'headers', 'request'].includes(stored) ? stored : 'body';
}

function saveActiveTab() {
  localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, state.activeTab);
}

function bindEvents() {
  elements.methodInput.addEventListener('change', () => {
    state.request.method = elements.methodInput.value;
    handleDraftChange();
  });

  elements.urlInput.addEventListener('input', () => {
    state.request.url = elements.urlInput.value;
    handleDraftChange();
  });

  elements.addQueryParamButton.addEventListener('click', () => {
    state.request.queryParams.push(createEmptyRow());
    saveRequestState();
    renderKeyValueList('queryParams');
    renderResolvedRequestPreview();
    setComposerStatus('Query param added to the draft.', 'neutral');
    renderRequestStateBadge();
  });

  elements.addHeaderButton.addEventListener('click', () => {
    state.request.headers.push(createEmptyRow());
    saveRequestState();
    renderKeyValueList('headers');
    renderResolvedRequestPreview();
    setComposerStatus('Header row added to the draft.', 'neutral');
    renderRequestStateBadge();
  });

  elements.bodyEnabledInput.addEventListener('change', () => {
    state.request.bodyEnabled = elements.bodyEnabledInput.checked;
    saveRequestState();
    renderBodyState();
    renderResolvedRequestPreview();
    setComposerStatus(state.request.bodyEnabled ? 'Request body enabled.' : 'Request body disabled.', 'neutral');
    renderRequestStateBadge();
  });

  elements.bodyModeInput.addEventListener('change', () => {
    state.request.bodyMode = elements.bodyModeInput.value;
    handleDraftChange();
  });

  elements.bodyInput.addEventListener('input', () => {
    state.request.body = elements.bodyInput.value;
    handleDraftChange();
  });

  elements.presetSelect.addEventListener('change', () => {
    state.request.selectedPresetId = elements.presetSelect.value;
    saveRequestState();
    renderPresetMeta();
    setComposerStatus('Preset selection changed. Load it to replace the current draft.', 'neutral');
    renderRequestStateBadge();
  });

  elements.applyPresetButton.addEventListener('click', () => {
    applyPreset(state.request.selectedPresetId);
    setComposerStatus('Preset loaded into the draft. The last response snapshot was kept.', 'success');
  });

  elements.formatBodyButton.addEventListener('click', () => {
    if (state.request.bodyMode !== 'json') {
      return;
    }

    try {
      state.request.body = JSON.stringify(JSON.parse(state.request.body), null, 2);
      saveRequestState();
      renderBodyState();
      renderResolvedRequestPreview();
      setComposerStatus('Body formatted as JSON.', 'success');
      renderRequestStateBadge();
    } catch (error) {
      setComposerStatus(`Body JSON is invalid: ${String(error.message || error)}`, 'error');
    }
  });

  elements.sendRequestButton.addEventListener('click', sendRequest);

  elements.saveRequestButton.addEventListener('click', () => {
    saveRequestState();
    setComposerStatus('Draft saved locally.', 'success');
    renderRequestStateBadge();
  });

  elements.resetRequestButton.addEventListener('click', () => {
    state.request = structuredClone(defaultRequestState);
    saveRequestState();
    renderRequestComposer();
    setComposerStatus('Default request restored. The last response snapshot was kept.', 'success');
  });

  elements.copyActiveResponseButton.addEventListener('click', copyActiveResponseTab);

  for (const button of elements.tabButtons) {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  }
}

function render() {
  renderRequestComposer();
  renderResponseSnapshot();
  activateTab(state.activeTab);
  renderSendButton();
}

function renderRequestComposer() {
  renderPresetOptions();
  elements.methodInput.value = state.request.method;
  elements.urlInput.value = state.request.url;
  renderKeyValueList('queryParams');
  renderKeyValueList('headers');
  renderBodyState();
  renderResolvedRequestPreview();
  renderPresetMeta();
  renderComposerStatus();
  renderRequestStateBadge();
}

function renderKeyValueList(type) {
  const target = type === 'queryParams' ? elements.queryParamsList : elements.headersList;
  target.textContent = '';

  state.request[type].forEach((entry, index) => {
    const fragment = elements.kvRowTemplate.content.cloneNode(true);
    const keyInput = fragment.querySelector('.kv-key');
    const valueInput = fragment.querySelector('.kv-value');
    const enabledInput = fragment.querySelector('.kv-enabled');
    const removeButton = fragment.querySelector('.kv-remove');

    keyInput.value = entry.key;
    valueInput.value = entry.value;
    enabledInput.checked = entry.enabled;

    keyInput.addEventListener('input', () => {
      state.request[type][index].key = keyInput.value;
      handleDraftChange();
    });

    valueInput.addEventListener('input', () => {
      state.request[type][index].value = valueInput.value;
      handleDraftChange();
    });

    enabledInput.addEventListener('change', () => {
      state.request[type][index].enabled = enabledInput.checked;
      handleDraftChange();
    });

    removeButton.addEventListener('click', () => {
      state.request[type].splice(index, 1);
      saveRequestState();
      renderKeyValueList(type);
      renderResolvedRequestPreview();
      setComposerStatus(`${type === 'queryParams' ? 'Query param' : 'Header'} removed from the draft.`, 'neutral');
      renderRequestStateBadge();
    });

    target.appendChild(fragment);
  });
}

function renderBodyState() {
  elements.bodyEnabledInput.checked = state.request.bodyEnabled;
  elements.bodyModeInput.value = state.request.bodyMode;
  elements.bodyInput.value = state.request.body;
  elements.bodyInput.disabled = !state.request.bodyEnabled;
  elements.bodyModeInput.disabled = !state.request.bodyEnabled;
  elements.formatBodyButton.disabled = !state.request.bodyEnabled || state.request.bodyMode !== 'json';
}

function renderPresetOptions() {
  elements.presetSelect.textContent = '';

  for (const preset of PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    elements.presetSelect.appendChild(option);
  }

  const selectedPreset = PRESETS.some((preset) => preset.id === state.request.selectedPresetId)
    ? state.request.selectedPresetId
    : PRESETS[0].id;

  elements.presetSelect.value = selectedPreset;
  state.request.selectedPresetId = selectedPreset;
}

function renderPresetMeta() {
  const preset = getPresetById(state.request.selectedPresetId);
  elements.presetDescription.textContent = preset?.description || '';
}

function applyPreset(presetId) {
  const preset = getPresetById(presetId);
  if (!preset) {
    return;
  }

  state.request = {
    selectedPresetId: preset.id,
    ...structuredClone(preset.request),
  };

  saveRequestState();
  renderRequestComposer();
}

function renderResolvedRequestPreview() {
  elements.resolvedRequestPreview.textContent = getResolvedRequestPreview();
}

function getResolvedRequestPreview() {
  try {
    return JSON.stringify(buildResolvedRequest(), null, 2);
  } catch (error) {
    return JSON.stringify(
      {
        error: String(error.message || error),
      },
      null,
      2
    );
  }
}

function buildResolvedRequest() {
  if (!state.request.url.trim()) {
    throw new Error('URL is required.');
  }

  let url;
  try {
    url = new URL(state.request.url);
  } catch {
    throw new Error('URL must be absolute, for example https://example.com/path.');
  }

  for (const param of state.request.queryParams) {
    if (!param.enabled || !param.key) {
      continue;
    }
    url.searchParams.set(param.key, param.value);
  }

  const headers = {};
  for (const header of state.request.headers) {
    if (!header.enabled || !header.key) {
      continue;
    }
    headers[header.key] = header.value;
  }

  return {
    method: state.request.method,
    url: url.toString(),
    headers,
    body: state.request.bodyEnabled ? state.request.body : null,
  };
}

async function sendRequest() {
  const startedAt = performance.now();
  let resolved;

  try {
    resolved = buildResolvedRequest();
  } catch (error) {
    setComposerStatus(`Request is invalid: ${String(error.message || error)}`, 'error');
    activateTab('request');
    return;
  }

  let requestBody;
  try {
    requestBody = buildRequestBody();
  } catch (error) {
    setComposerStatus(`Request body is invalid: ${String(error.message || error)}`, 'error');
    activateTab('request');
    return;
  }

  state.isSubmitting = true;
  renderSendButton();
  setComposerStatus('Sending request. The last response snapshot will stay visible until this run finishes.', 'neutral');

  try {
    const response = await fetch(resolved.url, {
      method: resolved.method,
      headers: resolved.headers,
      body: requestBody,
    });

    const duration = Math.round(performance.now() - startedAt);
    const rawText = await response.text();
    const headersObject = Object.fromEntries(response.headers.entries());
    const size = new TextEncoder().encode(rawText).length;
    const completedAt = new Date();

    state.response = {
      status: `${response.status} ${response.statusText}`,
      duration: `${duration} ms`,
      size: `${size} B`,
      ok: response.ok,
      body: formatResponseBody(rawText, headersObject['content-type']),
      headers: JSON.stringify(headersObject, null, 2),
      request: JSON.stringify(
        {
          ...resolved,
          body: requestBody,
        },
        null,
        2
      ),
      summary: `Response captured ${formatTimestamp(completedAt)}. This snapshot will stay here until the next request finishes.`,
      lastUpdatedAt: completedAt.toISOString(),
    };

    saveResponseState();
    renderResponseSnapshot();
    activateTab('body');
    setComposerStatus('Request completed. Review the response snapshot on the right.', response.ok ? 'success' : 'error');
  } catch (error) {
    const duration = `${Math.round(performance.now() - startedAt)} ms`;
    const completedAt = new Date();

    state.response = {
      status: 'Request failed',
      duration,
      size: '--',
      ok: false,
      body: String(error.message || error),
      headers: 'No response headers received.',
      request: JSON.stringify(
        {
          ...resolved,
          body: requestBody,
        },
        null,
        2
      ),
      summary: `Request failed ${formatTimestamp(completedAt)}. This failure snapshot will stay here until the next request finishes.`,
      lastUpdatedAt: completedAt.toISOString(),
    };

    saveResponseState();
    renderResponseSnapshot();
    activateTab('body');
    setComposerStatus('Request failed. The response panel now shows the failure snapshot.', 'error');
  } finally {
    state.isSubmitting = false;
    renderSendButton();
  }
}

function buildRequestBody() {
  if (!state.request.bodyEnabled) {
    return undefined;
  }

  if (state.request.method === 'GET' || state.request.method === 'HEAD') {
    return undefined;
  }

  if (state.request.bodyMode === 'json') {
    return JSON.stringify(JSON.parse(state.request.body));
  }

  return state.request.body;
}

function formatResponseBody(rawText, contentType = '') {
  if (!rawText) {
    return 'Response body is empty.';
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      return rawText;
    }
  }

  try {
    return JSON.stringify(JSON.parse(rawText), null, 2);
  } catch {
    return rawText;
  }
}

function activateTab(tabName) {
  state.activeTab = tabName;
  saveActiveTab();

  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
  }

  elements.copyActiveResponseButton.textContent = `Copy ${getActiveTabLabel()}`;
}

function renderResponseSnapshot() {
  elements.responseStatus.textContent = state.response.status;
  elements.responseDuration.textContent = state.response.duration;
  elements.responseSize.textContent = state.response.size;
  elements.responseBodyOutput.textContent = state.response.body;
  elements.responseHeadersOutput.textContent = state.response.headers;
  elements.resolvedRequestOutput.textContent = state.response.request;
  elements.responseSummary.textContent = state.response.summary;

  elements.responseStatus.classList.toggle('status-ok', state.response.ok === true);
  elements.responseStatus.classList.toggle('status-error', state.response.ok === false);
}

function renderComposerStatus() {
  elements.composerStatus.textContent = state.composerStatus;
  elements.composerStatus.dataset.tone = state.composerTone;
}

function setComposerStatus(message, tone = 'neutral') {
  state.composerStatus = message;
  state.composerTone = tone;
  renderComposerStatus();
}

function renderRequestStateBadge() {
  const preset = getPresetById(state.request.selectedPresetId);
  const presetLabel = preset ? preset.label : 'Custom';
  elements.requestStateBadge.textContent = `Auto-saved draft · ${presetLabel}`;
}

function renderSendButton() {
  elements.sendRequestButton.disabled = state.isSubmitting;
  elements.sendRequestButton.textContent = state.isSubmitting ? 'Sending Request...' : 'Send Request';
}

async function copyActiveResponseTab() {
  try {
    await navigator.clipboard.writeText(getActiveTabText());
    setComposerStatus(`${getActiveTabLabel()} copied to the clipboard.`, 'success');
  } catch (error) {
    setComposerStatus(`Copy failed: ${String(error.message || error)}`, 'error');
  }
}

function getActiveTabLabel() {
  if (state.activeTab === 'headers') {
    return 'Headers';
  }

  if (state.activeTab === 'request') {
    return 'Resolved Request';
  }

  return 'Body';
}

function getActiveTabText() {
  if (state.activeTab === 'headers') {
    return elements.responseHeadersOutput.textContent;
  }

  if (state.activeTab === 'request') {
    return elements.resolvedRequestOutput.textContent;
  }

  return elements.responseBodyOutput.textContent;
}

function handleDraftChange() {
  saveRequestState();
  renderResolvedRequestPreview();
  setComposerStatus('Draft updated locally. The last response snapshot is unchanged until you send again.', 'neutral');
  renderRequestStateBadge();
}

function createEmptyRow() {
  return {
    key: '',
    value: '',
    enabled: true,
  };
}

function getPresetById(presetId) {
  return PRESETS.find((preset) => preset.id === presetId);
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
