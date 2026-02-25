// Side Panel Script
// Handles UI, communication with background, and AI integration

let currentProblem = null;
let currentSolution = null;
let selectedLanguage = 'python';
let currentTabId = null;
let isProcessing = false;
let currentProblemUrl = null; // Track current URL to ignore stale callbacks
let selectedProfileId = null; // Currently selected profile for solving
let tooltipManuallyClosed = false; // Track if user manually closed the tooltip

// Track active abort controllers for each profile
const profileAbortControllers = new Map(); // profileId -> { controller, cancelled, status }

// Profile-based data structure
let profiles = []; // Array of profile objects
let generalSettings = {
  autoDetect: true,
  busyTimeout: 5 // minutes
};

// DOM Elements
const elements = {
  problemCard: document.getElementById('problemCard'),
  noProblemCard: document.getElementById('noProblemCard'),
  notWhitelistedCard: document.getElementById('notWhitelistedCard'),
  notWhitelistedUrl: document.getElementById('notWhitelistedUrl'),
  platformBadge: document.getElementById('platformBadge'),
  difficultyBadge: document.getElementById('difficultyBadge'),
  problemTitle: document.getElementById('problemTitle'),
  problemDescription: document.getElementById('problemDescription'),
  constraintsText: document.getElementById('constraintsText'),
  examplesText: document.getElementById('examplesText'),
  statusDot: document.querySelector('.status-dot'),
  statusTextMain: document.getElementById('statusTextMain'),
  statusBanner: document.getElementById('statusBanner'),
  statusText: document.getElementById('statusText'),
  settingsModal: document.getElementById('settingsModal'),
  solutionContainer: document.getElementById('solutionContainer'),
  noSolution: document.getElementById('noSolution'),
  solutionLoading: document.getElementById('solutionLoading'),
  solutionHeader: document.getElementById('solutionHeader'),
  solutionContent: document.getElementById('solutionContent'),
  solutionCode: document.getElementById('solutionCode'),
  removeSolutionBtn: document.getElementById('removeSolutionBtn'),
  copySolutionBtn: document.getElementById('copySolutionBtn'),
  complexityText: document.getElementById('complexityText'),
  explanationContent: document.getElementById('explanationContent'),
  currentTabName: document.getElementById('currentTabName'),
  processingIndicator: document.getElementById('processingIndicator'),
  processingProfilesList: document.getElementById('processingProfilesList'),
  profileSelect: document.getElementById('profileSelect'),
  profileStatus: document.getElementById('profileStatus'),
  whitelistContainer: document.getElementById('whitelistContainer'),
  newWebsiteInput: document.getElementById('newWebsiteInput')
};

// ========== Focus Protection Functions ==========

// Send focus protection message to content script
function sendFocusProtectionMessage(type, element = null) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'focusProtection',
        type: type,
        element: element
      }).catch(() => {
        // Content script might not be ready or tab doesn't support it
        console.log('[CodeSolver Pro] Could not send focus protection message');
      });
    }
  });
}

// Initialize focus protection when panel opens
function initFocusProtection() {
  sendFocusProtectionMessage('CODE_SOLVER_PANEL_OPEN');
}

// Notify when panel receives focus
function notifyPanelFocus(element = null) {
  sendFocusProtectionMessage('CODE_SOLVER_PANEL_FOCUS', element);
}

// Notify when panel closes
function notifyPanelClose() {
  sendFocusProtectionMessage('CODE_SOLVER_PANEL_CLOSE');
}

// Periodic heartbeat to keep focus protection active
let focusProtectionHeartbeat = null;
function startFocusProtectionHeartbeat() {
  // Send PANEL_OPEN message every 500ms to keep protection active
  if (focusProtectionHeartbeat) clearInterval(focusProtectionHeartbeat);
  focusProtectionHeartbeat = setInterval(() => {
    sendFocusProtectionMessage('CODE_SOLVER_PANEL_OPEN');
  }, 500);
}

function stopFocusProtectionHeartbeat() {
  if (focusProtectionHeartbeat) {
    clearInterval(focusProtectionHeartbeat);
    focusProtectionHeartbeat = null;
  }
}

// ========== Profile Management Functions ==========

// Generate a unique ID for a profile
function generateProfileId() {
  return 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Create a new profile
function createProfile(name, config) {
  const profile = {
    id: generateProfileId(),
    name: name,
    ...config,
    isDefault: profiles.length === 0 // First profile is default
  };
  profiles.push(profile);
  saveProfilesToStorage();
  return profile;
}

// Update an existing profile
function updateProfile(profileId, config) {
  const index = profiles.findIndex(p => p.id === profileId);
  if (index !== -1) {
    profiles[index] = { ...profiles[index], ...config };
    saveProfilesToStorage();
    return profiles[index];
  }
  return null;
}

// Delete a profile
function deleteProfile(profileId) {
  const index = profiles.findIndex(p => p.id === profileId);
  if (index !== -1) {
    profiles.splice(index, 1);

    // If deleted profile was default, make first profile default
    if (profiles.length > 0 && profiles.every(p => !p.isDefault)) {
      profiles[0].isDefault = true;
    }

    // If deleted profile was selected, select another
    if (selectedProfileId === profileId) {
      selectedProfileId = profiles.length > 0 ? profiles[0].id : null;
    }

    saveProfilesToStorage();
    return true;
  }
  return false;
}

// Get a profile by ID
function getProfile(profileId) {
  return profiles.find(p => p.id === profileId) || null;
}

// Get the default profile
function getDefaultProfile() {
  return profiles.find(p => p.isDefault) || profiles[0] || null;
}

// Set default profile
function setDefaultProfile(profileId) {
  profiles.forEach(p => p.isDefault = (p.id === profileId));
  saveProfilesToStorage();
}

// Save profiles to storage
function saveProfilesToStorage() {
  chrome.storage.local.set({
    aiProfiles: profiles,
    selectedProfileId: selectedProfileId,
    generalSettings: generalSettings
  });
}

// Load profiles from storage
function loadProfilesFromStorage(callback) {
  chrome.storage.local.get(['aiProfiles', 'selectedProfileId', 'generalSettings'], (result) => {
    if (result.aiProfiles && Array.isArray(result.aiProfiles)) {
      // Filter out null or invalid profiles
      profiles = result.aiProfiles.filter(p => p && p.id && p.name);
    } else {
      // Migrate old settings to new profile format
      migrateOldSettingsToProfiles(result);
    }

    // Ensure at least one valid profile exists
    if (profiles.length === 0) {
      migrateOldSettingsToProfiles({});
    }

    if (result.selectedProfileId) {
      selectedProfileId = result.selectedProfileId;
    } else if (profiles.length > 0 && profiles[0]) {
      selectedProfileId = profiles[0].id;
    }

    if (result.generalSettings) {
      generalSettings = { ...generalSettings, ...result.generalSettings };
    }

    callback();
  });
}

// Migrate old single settings to profile format
function migrateOldSettingsToProfiles(oldSettings) {
  if (!oldSettings || (!oldSettings.settings && !oldSettings.aiProfiles)) {
    // Create default profile if no settings exist
    createProfile('Default Profile', {
      apiProvider: 'openai',
      apiKey: '',
      localUrl: 'http://localhost:11434/v1/chat/completions',
      llamaUrl: 'http://localhost:8080/v1/chat/completions',
      model: 'gpt-4',
      temperature: 0.2,
      maxTokens: 4096,
      topP: 1.0,
      systemPrompt: 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.'
    });
    return;
  }

  // If old settings exist, create a profile from them
  const old = oldSettings.settings || {};
  if (old.apiProvider || old.apiKey) {
    createProfile('Migrated Profile', {
      apiProvider: old.apiProvider || 'openai',
      apiKey: old.apiKey || '',
      localUrl: old.localUrl || 'http://localhost:11434/api/generate',
      llamaUrl: old.llamaUrl || 'http://localhost:8080/v1/chat/completions',
      model: old.model || 'gpt-4',
      temperature: old.temperature || 0.2,
      maxTokens: old.maxTokens || 4096,
      topP: old.topP || 1.0,
      systemPrompt: old.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.'
    });
  }
}

// Get busy profiles from storage (for multi-tab concurrent solving)
function getBusyProfiles(callback) {
  chrome.storage.local.get(['busyProfiles'], (result) => {
    callback(result.busyProfiles || {});
  });
}

// Set a profile as busy or not busy
function setProfileBusy(profileId, isBusy, solvingInfo = null) {
  getBusyProfiles((busyProfiles) => {
    if (isBusy) {
      busyProfiles[profileId] = {
        timestamp: Date.now(),
        ...solvingInfo
      };
    } else {
      delete busyProfiles[profileId];
    }
    chrome.storage.local.set({ busyProfiles });
    updateProfileUI();
  });
}

// Update profile-related UI elements
function updateProfileUI() {
  // Update profile dropdown in solution tab
  updateProfileDropdown();

  // Update profiles list in settings modal
  updateProfilesList();

  // Update processing indicator to show all busy profiles
  updateProcessingIndicator();

  // Update solve button state based on selected profile's busy status
  getBusyProfiles((busyProfiles) => {
    const isBusy = selectedProfileId && busyProfiles[selectedProfileId];
    updateSolveButtonState(!!isBusy);

    // Update profile status indicator
    if (elements.profileStatus) {
      if (isBusy) {
        elements.profileStatus.classList.add('busy');
      } else {
        elements.profileStatus.classList.remove('busy');
      }
    }
  });
}

// Update profile dropdown in solution tab
function updateProfileDropdown() {
  if (!elements.profileSelect) return;

  elements.profileSelect.innerHTML = '';

  if (profiles.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'No profiles configured';
    option.disabled = true;
    elements.profileSelect.appendChild(option);
    selectedProfileId = null;
    return;
  }

  profiles.forEach(profile => {
    // Skip null or invalid profiles
    if (!profile || !profile.id) return;

    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name + (profile.isDefault ? ' (Default)' : '');

    // Check if this profile is busy
    getBusyProfiles((busyProfiles) => {
      if (busyProfiles[profile.id]) {
        option.textContent += ' - Busy...';
        option.disabled = true;
      }
    });

    elements.profileSelect.appendChild(option);
  });

  // Set selected profile
  if (selectedProfileId) {
    elements.profileSelect.value = selectedProfileId;
  } else if (profiles.length > 0) {
    selectedProfileId = profiles[0].id;
    elements.profileSelect.value = selectedProfileId;
  }
}

// Update profiles list in settings modal
function updateProfilesList() {
  const profilesList = document.getElementById('profilesList');
  if (!profilesList) return;

  profilesList.innerHTML = '';

  if (profiles.length === 0) {
    profilesList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-secondary); font-size: 12px;">No profiles yet. Click "Add Profile" to create one.</div>';
    return;
  }

  profiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = 'profile-item';
    if (profile.id === selectedProfileId) {
      item.classList.add('active');
    }

    item.innerHTML = `
      <div style="display: flex; align-items: center;">
        <span class="profile-item-name">${escapeHtml(profile.name)}</span>
        <span class="profile-item-provider">${getProviderDisplayName(profile.apiProvider)}</span>
        ${profile.isDefault ? '<span style="margin-left: 6px; font-size: 10px; color: var(--accent-primary);">(Default)</span>' : ''}
      </div>
      <div class="profile-item-status" data-profile-id="${profile.id}"></div>
    `;

    item.addEventListener('click', () => {
      selectedProfileId = profile.id;
      loadProfileIntoForm(profile);
      updateProfilesList();
      updateProfileDropdown();
    });

    profilesList.appendChild(item);
  });

  // Update status indicators
  getBusyProfiles((busyProfiles) => {
    profiles.forEach(profile => {
      const statusEl = profilesList.querySelector(`[data-profile-id="${profile.id}"]`);
      if (statusEl) {
        statusEl.className = 'profile-item-status';
        if (busyProfiles[profile.id]) {
          statusEl.classList.add('busy');
        } else {
          statusEl.classList.add('available');
        }
      }
    });
  });
}

// Get display name for provider
function getProviderDisplayName(provider) {
  const names = {
    'openai': 'OpenAI',
    'anthropic': 'Claude',
    'llama': 'Llama',
    'local': 'Ollama'
  };
  return names[provider] || provider;
}

// Load profile data into the settings form
function loadProfileIntoForm(profile) {
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('apiProvider').value = profile.apiProvider || 'openai';
  document.getElementById('apiKey').value = profile.apiKey || '';
  document.getElementById('localUrl').value = profile.localUrl || 'http://localhost:11434/v1/chat/completions';
  document.getElementById('llamaUrl').value = profile.llamaUrl || 'http://localhost:8080/v1/chat/completions';
  document.getElementById('modelSelect').value = profile.model || 'gpt-4';
  document.getElementById('temperature').value = profile.temperature || 0.2;
  document.getElementById('maxTokens').value = profile.maxTokens || 4096;
  document.getElementById('topP').value = profile.topP || 1.0;
  document.getElementById('systemPrompt').value = profile.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.';

  // Show/hide URL fields based on provider
  const localUrlGroup = document.getElementById('localUrlGroup');
  const llamaUrlGroup = document.getElementById('llamaUrlGroup');

  localUrlGroup.style.display = 'none';
  llamaUrlGroup.style.display = 'none';

  if (profile.apiProvider === 'local') {
    localUrlGroup.style.display = 'block';
  } else if (profile.apiProvider === 'llama') {
    llamaUrlGroup.style.display = 'block';
  }

  // Show delete button for existing profiles (not for new ones)
  const deleteBtn = document.getElementById('deleteProfileBtn');
  if (deleteBtn) {
    deleteBtn.style.display = profiles.find(p => p.id === profile.id) ? 'block' : 'none';
  }
}

// Get profile data from form
function getProfileFromForm() {
  return {
    name: document.getElementById('profileName').value.trim() || 'Unnamed Profile',
    apiProvider: document.getElementById('apiProvider').value,
    apiKey: document.getElementById('apiKey').value,
    localUrl: document.getElementById('localUrl').value,
    llamaUrl: document.getElementById('llamaUrl').value,
    model: document.getElementById('modelSelect').value,
    temperature: parseFloat(document.getElementById('temperature').value) || 0.2,
    maxTokens: parseInt(document.getElementById('maxTokens').value) || 4096,
    topP: parseFloat(document.getElementById('topP').value) || 1.0,
    systemPrompt: document.getElementById('systemPrompt').value
  };
}

// ========== End Profile Management Functions ==========

// ========== Whitelist Management Functions ==========

// Default coding platforms that are always whitelisted (cannot be removed)
const defaultWhitelist = [
  'leetcode.com',
  'leetcode.cn',
  'leetcode.org',
  'hackerrank.com',
  'codesignal.com',
  'codeforces.com',
  'codewars.com',
  'interviewbit.com',
  'hackerearth.com',
  'algoexpert.io',
  'binarysearch.com',
  'cses.fi',
  'atcoder.jp',
  'lichess.org',
  'codingbat.com',
  'coderbyte.com',
  'projecteuler.net',
  'hackerrank.com',
  'kattis.com',
  'dmoj.ca',
  'spoj.com',
  'codechef.com',
  'topcoder.com',
  'geeksforgeeks.org',
  'skillrack.com',
  'devskill.com',
  'beecrowd.com.br',
  'uri.onlinejudge.ufrj.br',
  'lightoj.com',
  'uva.onlinejudge.org',
  'acm.timus.ru'
];

// User's custom whitelist
let customWhitelist = [];

// Get all whitelisted domains (default + custom)
function getAllWhitelistedDomains() {
  return [...defaultWhitelist, ...customWhitelist];
}

// Check if a URL is whitelisted
function isUrlWhitelisted(url) {
  if (!url) return false;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Check against default whitelist first (always available)
    const defaultMatch = defaultWhitelist.some(whitelisted => {
      if (domain === whitelisted) return true;
      if (domain.endsWith('.' + whitelisted)) return true;
      return false;
    });

    if (defaultMatch) return true;

    // Check against custom whitelist
    const customMatch = customWhitelist.some(whitelisted => {
      if (domain === whitelisted) return true;
      if (domain.endsWith('.' + whitelisted)) return true;
      return false;
    });

    return customMatch;
  } catch {
    return false;
  }
}

// Extract domain from URL string
function extractDomain(urlString) {
  try {
    const url = new URL(urlString);
    return getBaseDomain(url.hostname);
  } catch {
    // If URL parsing fails, try to extract domain manually
    const match = urlString.match(/^https?:\/\/([^\/]+)/);
    return match ? getBaseDomain(match[1]) : urlString;
  }
}

// Get base domain (remove www. or other subdomains for cleaner display)
function getBaseDomain(hostname) {
  if (!hostname) return hostname;

  // Remove www. prefix for cleaner display
  if (hostname.startsWith('www.')) {
    hostname = hostname.substring(4);
  }

  // For common coding platforms, keep the full domain
  // For others, extract just the main domain
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  // Keep at least 2 parts (domain.tld) or 3 for co.uk, com.au etc
  const tld = parts[parts.length - 1];
  const secondLevel = parts[parts.length - 2];

  // Common two-part TLDs
  if (['co', 'com', 'org', 'net', 'edu', 'gov', 'ac'].includes(tld)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

// Load whitelist from storage
function loadWhitelistFromStorage() {
  chrome.storage.local.get(['customWhitelist'], (result) => {
    if (result.customWhitelist && Array.isArray(result.customWhitelist)) {
      customWhitelist = result.customWhitelist;
    }
    updateWhitelistUI();
  });
}

// Save whitelist to storage
function saveWhitelistToStorage() {
  chrome.storage.local.set({ customWhitelist });
}

// Add a website to the whitelist
function addWebsiteToWhitelist(urlString) {
  const domain = extractDomain(urlString);

  // Check if already in default whitelist
  if (defaultWhitelist.includes(domain)) {
    showStatus('This website is already whitelisted by default', 'error');
    return false;
  }

  // Check if already in custom whitelist
  if (customWhitelist.includes(domain)) {
    showStatus('This website is already in your whitelist', 'error');
    return false;
  }

  // Add to custom whitelist
  customWhitelist.push(domain);
  saveWhitelistToStorage();
  updateWhitelistUI();
  showStatus('Website added to whitelist', 'success');
  return true;
}

// Remove a website from the custom whitelist (can only remove custom ones)
function removeWebsiteFromWhitelist(domain) {
  const index = customWhitelist.indexOf(domain);
  if (index !== -1) {
    customWhitelist.splice(index, 1);
    saveWhitelistToStorage();
    updateWhitelistUI();
    showStatus('Website removed from whitelist', 'success');
    return true;
  }
  return false;
}

// Update whitelist UI in settings modal
function updateWhitelistUI() {
  if (!elements.whitelistContainer) return;

  elements.whitelistContainer.innerHTML = '';

  // Add default whitelist items (read-only)
  defaultWhitelist.forEach(domain => {
    const item = document.createElement('div');
    item.className = 'whitelist-item default';
    item.innerHTML = `
      <span class="whitelist-item-badge">Default</span>
      <span class="whitelist-item-name">${escapeHtml(domain)}</span>
    `;
    elements.whitelistContainer.appendChild(item);
  });

  // Add custom whitelist items (removable)
  customWhitelist.forEach(domain => {
    const item = document.createElement('div');
    item.className = 'whitelist-item';
    item.innerHTML = `
      <span class="whitelist-item-name">${escapeHtml(domain)}</span>
      <button class="whitelist-item-remove" data-domain="${escapeHtml(domain)}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // Add remove button listener
    const removeBtn = item.querySelector('.whitelist-item-remove');
    removeBtn.addEventListener('click', () => {
      if (confirm(`Remove ${domain} from whitelist?`)) {
        removeWebsiteFromWhitelist(domain);
      }
    });

    elements.whitelistContainer.appendChild(item);
  });
}

// Show not whitelisted state
function showNotWhitelistedState(url) {
  const domain = extractDomain(url);

  // Hide all cards
  elements.problemCard.classList.add('hidden');
  elements.noProblemCard.classList.add('hidden');

  // Show not whitelisted card
  elements.notWhitelistedCard.classList.remove('hidden');
  elements.notWhitelistedUrl.textContent = domain;

  // Update status
  elements.statusDot.classList.add('error');
  elements.statusTextMain.textContent = 'Not whitelisted';
}

// Hide not whitelisted state
function hideNotWhitelistedState() {
  elements.notWhitelistedCard.classList.add('hidden');
}

// ========== End Whitelist Management Functions ==========

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadProfilesFromStorage(() => {
    setupEventListeners();
    updateProfileUI();

    // Apply general settings to UI
    document.getElementById('autoDetect').checked = generalSettings.autoDetect !== false;
    document.getElementById('busyTimeout').value = generalSettings.busyTimeout || 5;

    // Load whitelist
    loadWhitelistFromStorage();
  });

  // Listen for changes to busy profiles to update UI across all tabs
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.busyProfiles) {
      updateProfileUI();
    }
  });

  // Get current tab ID and update tab name
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      currentTabId = tabs[0].id;
      updateTabName(tabs[0]);

      // Initialize focus protection - notify page that panel is open
      initFocusProtection();

      // Start heartbeat to keep protection active
      startFocusProtectionHeartbeat();

      // Check for any busy profiles and update solve button accordingly
      chrome.storage.local.get(['busyProfiles'], (result) => {
        const busyProfiles = result.busyProfiles || {};
        const hasBusyProfiles = Object.keys(busyProfiles).length > 0;

        // Update solve button - if any profile is busy, we still need to check the selected one
        updateProfileUI();

        // Update processing indicator every second when there are busy profiles
        setInterval(() => {
          chrome.storage.local.get(['busyProfiles'], (result) => {
            if (result.busyProfiles && Object.keys(result.busyProfiles).length > 0) {
              updateProcessingIndicator();
            }
          });
        }, 1000);

        // If there are busy profiles, show the processing indicator
        if (hasBusyProfiles) {
          updateProcessingIndicator();
        } else {
          checkForStoredProblemAndDetect();
        }
      });
    }
  });
});

// Add focus/click listener to notify page when panel is interacted with
document.addEventListener('click', () => {
  notifyPanelFocus(document.activeElement);
}, true);

document.addEventListener('focus', () => {
  notifyPanelFocus(document.activeElement);
}, true);

// Handle panel close (Chrome Side Panel API doesn't have a close event, but we can try)
window.addEventListener('beforeunload', () => {
  notifyPanelClose();
  stopFocusProtectionHeartbeat();
});

// Check for stored problem and detect if needed
function checkForStoredProblemAndDetect() {
  chrome.tabs.get(currentTabId, (tab) => {
    if (!tab) return;

    chrome.storage.local.get(['currentProblem'], (result) => {
      if (result.currentProblem && result.currentProblem.url) {
        // Verify the stored problem matches the current tab URL
        const tabUrl = tab.url.split('?')[0].split('#')[0];
        const problemUrl = result.currentProblem.url.split('?')[0].split('#')[0];

        if (tabUrl.includes(problemUrl)) {
          // Problem matches this tab, display it
          displayProblem(result.currentProblem);
        } else {
          // Stored problem is from a different tab, detect fresh
          chrome.tabs.sendMessage(currentTabId, { action: 'detectCurrentPage' }, (response) => {
            if (response?.data) {
              displayProblem(response.data);
            } else {
              // No problem found - show no-problem state
              elements.problemCard.classList.add('hidden');
              elements.noProblemCard.classList.remove('hidden');
              elements.statusDot.classList.add('error');
              elements.statusTextMain.textContent = 'No problem detected';
            }
          });
        }
      } else {
        // No stored problem, trigger detection
        chrome.tabs.sendMessage(currentTabId, { action: 'detectCurrentPage' }, (response) => {
          if (response?.data) {
            displayProblem(response.data);
          } else {
            // No problem found - show no-problem state
            elements.problemCard.classList.add('hidden');
            elements.noProblemCard.classList.remove('hidden');
            elements.statusDot.classList.add('error');
            elements.statusTextMain.textContent = 'No problem detected';
          }
        });
      }
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // Solve button
  document.getElementById('solveBtn')?.addEventListener('click', solveProblem);

  // Copy solution button
  document.getElementById('copySolutionBtn')?.addEventListener('click', copySolution);

  // Remove solution button
  document.getElementById('removeSolutionBtn')?.addEventListener('click', removeSolution);

  // Refresh buttons
  document.getElementById('refreshBtn')?.addEventListener('click', refreshDetection);
  document.getElementById('refreshDetectionBtn')?.addEventListener('click', refreshDetection);

  // Settings button - load profiles and whitelist when opening modal
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    updateProfilesList();
    updateWhitelistUI();
    // Load selected profile or first profile into form
    if (selectedProfileId) {
      const profile = getProfile(selectedProfileId);
      if (profile) {
        loadProfileIntoForm(profile);
      }
    } else if (profiles.length > 0) {
      loadProfileIntoForm(profiles[0]);
    }
    elements.settingsModal.classList.remove('hidden');
  });

  document.getElementById('closeSettings')?.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  // Profile management buttons
  document.getElementById('addProfileBtn')?.addEventListener('click', () => {
    // Clear form for new profile
    document.getElementById('profileName').value = '';
    document.getElementById('apiProvider').value = 'openai';
    document.getElementById('apiKey').value = '';
    document.getElementById('localUrl').value = 'http://localhost:11434/v1/chat/completions';
    document.getElementById('llamaUrl').value = 'http://localhost:8080/v1/chat/completions';
    document.getElementById('modelSelect').value = 'gpt-4';
    document.getElementById('temperature').value = 0.2;
    document.getElementById('maxTokens').value = 4096;
    document.getElementById('topP').value = 1.0;
    document.getElementById('systemPrompt').value = 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.';
    document.getElementById('localUrlGroup').style.display = 'none';
    document.getElementById('llamaUrlGroup').style.display = 'none';
    document.getElementById('deleteProfileBtn').style.display = 'none';

    selectedProfileId = null;
    updateProfilesList();
  });

  document.getElementById('saveProfileBtn')?.addEventListener('click', () => {
    const profileData = getProfileFromForm();

    if (selectedProfileId) {
      // Update existing profile
      updateProfile(selectedProfileId, profileData);
      showStatus('Profile updated!', 'success');
    } else {
      // Create new profile
      const newProfile = createProfile(profileData.name, profileData);
      selectedProfileId = newProfile.id;
      showStatus('Profile created!', 'success');
    }

    updateProfilesList();
    updateProfileDropdown();
  });

  document.getElementById('deleteProfileBtn')?.addEventListener('click', () => {
    if (selectedProfileId && confirm('Are you sure you want to delete this profile?')) {
      deleteProfile(selectedProfileId);
      showStatus('Profile deleted!', 'success');

      // Load another profile into form
      if (profiles.length > 0) {
        loadProfileIntoForm(profiles[0]);
      }
      updateProfilesList();
      updateProfileDropdown();
    }
  });

  // Profile selector in solution tab
  elements.profileSelect?.addEventListener('change', (e) => {
    selectedProfileId = e.target.value;
    saveProfilesToStorage();
    updateProfileUI();
  });

  // API provider change (in settings form)
  document.getElementById('apiProvider')?.addEventListener('change', (e) => {
    const localUrlGroup = document.getElementById('localUrlGroup');
    const llamaUrlGroup = document.getElementById('llamaUrlGroup');
    if (e.target.value === 'local') {
      localUrlGroup?.style.setProperty('display', 'block');
      llamaUrlGroup?.style.setProperty('display', 'none');
    } else if (e.target.value === 'llama') {
      localUrlGroup?.style.setProperty('display', 'none');
      llamaUrlGroup?.style.setProperty('display', 'block');
    } else {
      localUrlGroup?.style.setProperty('display', 'none');
      llamaUrlGroup?.style.setProperty('display', 'none');
    }
  });

  // Auto-detect checkbox
  document.getElementById('autoDetect')?.addEventListener('change', (e) => {
    generalSettings.autoDetect = e.target.checked;
    saveProfilesToStorage();
  });

  // Busy timeout input
  document.getElementById('busyTimeout')?.addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    if (value >= 1 && value <= 60) {
      generalSettings.busyTimeout = value;
      saveProfilesToStorage();
      showStatus(`Busy timeout set to ${value} minutes`, 'success');
    } else {
      e.target.value = generalSettings.busyTimeout || 5;
      showStatus('Timeout must be between 1 and 60 minutes', 'error');
    }
  });

  // Close banner
  document.getElementById('closeBanner')?.addEventListener('click', () => {
    // Check if there are any busy profiles before allowing banner to close
    getBusyProfiles((busyProfiles) => {
      const hasBusyProfiles = Object.keys(busyProfiles).length > 0;
      if (hasBusyProfiles) {
        showStatus('Cannot close banner while work is in progress', 'error');
        return;
      }
      elements.statusBanner.classList.add('hidden');
    });
  });

  // Close tooltip button
  document.getElementById('closeTooltipBtn')?.addEventListener('click', () => {
    // Just hide the tooltip, keep the indicator visible
    elements.processingIndicator.classList.remove('visible');
    tooltipManuallyClosed = true;
  });

  // Processing indicator click - keep tooltip visible
  elements.processingIndicator?.addEventListener('click', (e) => {
    // Don't toggle if clicking on the close button
    if (e.target.closest('#closeTooltipBtn')) return;

    // Toggle visibility state
    elements.processingIndicator.classList.toggle('visible');
  });

  // Language selector change
  document.getElementById('languageSelector')?.addEventListener('change', (e) => {
    selectedLanguage = e.target.value;

    // Load solution for the new language if a problem is currently displayed
    if (currentProblem && currentProblem.url) {
      loadSolution(currentProblem.url, selectedLanguage, (stored) => {
        if (stored && stored.solution) {
          currentSolution = stored.solution;
          displaySolution(stored.solution);
          showStatus(`Loaded saved solution (${stored.language})`, 'success');
        } else {
          // No solution for this language, reset
          resetSolution();
        }
      });
    } else {
      resetSolution();
    }
  });

  // Solution language selector change (in the solution tab)
  document.getElementById('solutionLanguageSelect')?.addEventListener('change', (e) => {
    const newLanguage = e.target.value;

    if (!currentProblem || !currentProblem.url) {
      showStatus('No problem loaded', 'error');
      return;
    }

    // Load solution for the selected language
    loadSolution(currentProblem.url, newLanguage, (stored) => {
      if (stored && stored.solution) {
        currentSolution = stored.solution;
        selectedLanguage = newLanguage;
        displaySolution(stored.solution);
        showStatus(`Loaded saved solution (${stored.language})`, 'success');
      } else {
        // No solution found for this language, reset UI
        resetSolution();
        showStatus(`No solution found for ${e.target.options[e.target.selectedIndex].text}`, 'error');
      }
    });
  });

  // Export and Clear buttons
  document.getElementById('exportSolutionsBtn')?.addEventListener('click', exportSolutionsToXML);
  document.getElementById('clearSolutionsBtn')?.addEventListener('click', clearAllSolutions);

  // Profiles Import/Export buttons
  document.getElementById('exportProfilesBtn')?.addEventListener('click', exportProfiles);
  document.getElementById('importProfilesBtn')?.addEventListener('click', importProfiles);

  // Whitelist management
  document.getElementById('addWebsiteBtn')?.addEventListener('click', () => {
    const input = elements.newWebsiteInput;
    const url = input?.value?.trim();

    if (!url) {
      showStatus('Please enter a website URL', 'error');
      return;
    }

    if (addWebsiteToWhitelist(url)) {
      input.value = ''; // Clear input on success
    }
  });

  // Allow Enter key to add website
  elements.newWebsiteInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('addWebsiteBtn')?.click();
    }
  });

  // Open settings from not whitelisted card
  document.getElementById('openSettingsWhitelistBtn')?.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
    updateWhitelistUI();
  });

  // Listen for problem detection from content script and background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'questionDetected') {
      displayProblem(request.data);
    }

    // Handle tab switching - show that tab's problem or clear if none
    if (request.action === 'tabChanged') {
      console.log('[SidePanel] Tab changed to:', request.tabId);
      currentTabId = request.tabId;

      // Update tab name display
      chrome.tabs.get(request.tabId, (tab) => {
        updateTabName(tab);
      });

      // Completely clear all problem data first
      clearAllProblemData();

      // Check for processing state first
      chrome.storage.local.get(['processingState'], (result) => {
        if (result.processingState) {
          const currentTime = Date.now();
          const processingAge = currentTime - result.processingState.timestamp;

          // If there's an active processing state, show indicator
          if (processingAge < 300000) {
            // Show processing indicator for the background task
            const processingProblem = result.processingState.problem || { title: result.processingState.url, url: result.processingState.url };
            showProcessingIndicator(result.processingState.url, processingProblem.title, result.processingState.language);

            // Now load the current tab's problem
            handleTabChange(request);
          } else {
            // Processing state is stale, clear it and proceed normally
            chrome.storage.local.remove('processingState');
            hideProcessingIndicator();
            handleTabChange(request);
          }
        } else {
          hideProcessingIndicator();
          handleTabChange(request);
        }
      });
    }

    // Handle tab update (navigation) - trigger new detection
    if (request.action === 'tabUpdated') {
      console.log('[SidePanel] Tab updated:', request.url);

      // Update tab name if tabId is provided
      if (request.tabId) {
        chrome.tabs.get(request.tabId, (tab) => {
          updateTabName(tab);
        });
      }

      // Clear all problem data completely
      clearAllProblemData();

      // Check if there's background processing for another tab
      chrome.storage.local.get(['processingState'], (result) => {
        if (result.processingState) {
          const currentTime = Date.now();
          const processingAge = currentTime - result.processingState.timestamp;

          if (processingAge < 300000) {
            // Show processing indicator for the background task
            const processingProblem = result.processingState.problem || { title: result.processingState.url, url: result.processingState.url };
            showProcessingIndicator(result.processingState.url, processingProblem.title, result.processingState.language);
          } else {
            // Processing state is stale, clear it
            chrome.storage.local.remove('processingState');
            hideProcessingIndicator();
          }
        } else {
          hideProcessingIndicator();
        }
      });

      // Set detecting state
      elements.statusDot.classList.remove('active', 'error');
      elements.statusTextMain.textContent = 'Detecting...';
      // Detection will be triggered by background script
    }
  });
}

// Handle tab change after checking processing state
function handleTabChange(request) {
  if (request.problem) {
    // Verify the problem matches the current tab before displaying
    // This prevents showing stale problems from other tabs
    chrome.tabs.get(currentTabId, (tab) => {
      if (!tab.url) {
        refreshDetection();
        return;
      }

      // Check if the problem URL matches the current tab URL
      const tabUrl = tab.url.split('?')[0].split('#')[0];
      const problemUrl = request.problem.url ? request.problem.url.split('?')[0].split('#')[0] : '';

      if (problemUrl && tabUrl.includes(problemUrl)) {
        // Problem URL matches this tab, display it
        displayProblem(request.problem);
      } else if (request.url && tabUrl.includes(request.url.split('?')[0].split('#')[0])) {
        // Use the URL from the request message for validation
        displayProblem(request.problem);
      } else {
        // URL mismatch, trigger fresh detection for this tab
        refreshDetection();
      }
    });
  } else {
    // No problem for this tab, trigger detection
    refreshDetection();
  }
}

// Update tab name display
function updateTabName(tab) {
  if (!tab) return;

  let tabName = 'Unknown Tab';

  if (tab.title) {
    // Use tab title, but truncate if too long
    tabName = tab.title.length > 40 ? tab.title.substring(0, 37) + '...' : tab.title;
  } else if (tab.url) {
    // Fallback to URL hostname
    try {
      const url = new URL(tab.url);
      tabName = url.hostname;
    } catch {
      tabName = 'Tab';
    }
  }

  elements.currentTabName.textContent = tabName;
}

// Clear all problem data completely
function clearAllProblemData() {
  // Reset state variables
  currentProblem = null;
  currentSolution = null;
  isProcessing = false;
  currentProblemUrl = null; // Reset URL tracker to invalidate pending callbacks

  // Show no-problem card and hide problem card
  elements.problemCard.classList.add('hidden');
  elements.noProblemCard.classList.remove('hidden');

  // Clear all UI elements including title
  elements.problemTitle.textContent = 'Untitled Problem';
  elements.problemDescription.textContent = '';
  elements.constraintsText.textContent = '';
  elements.examplesText.textContent = '';
  elements.solutionCode.textContent = '';
  elements.complexityText.textContent = '';
  elements.explanationContent.innerHTML = '<p class="placeholder-text">Solve the problem first to see detailed explanation.</p>';
  elements.platformBadge.textContent = 'Unknown';

  // Hide problem-specific elements
  document.getElementById('problemConstraints').classList.add('hidden');
  document.getElementById('problemExamples').classList.add('hidden');

  // Reset solution view
  elements.noSolution.classList.remove('hidden');
  elements.solutionLoading.classList.add('hidden');
  elements.solutionHeader.classList.add('hidden');
  elements.removeSolutionBtn.classList.add('hidden');
  elements.copySolutionBtn.classList.add('hidden');
  elements.solutionContent.classList.add('hidden');

  // Reset status
  elements.statusDot.classList.remove('active');
  elements.statusTextMain.textContent = 'Detecting...';

  // Enable solve button
  document.getElementById('solveBtn').disabled = false;

  console.log('[SidePanel] All problem data cleared');
}

// Tab Switching
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `${tabName}Tab`);
  });
}

// Display Problem
function displayProblem(problem) {
  if (!problem) {
    elements.problemCard.classList.add('hidden');
    elements.noProblemCard.classList.remove('hidden');
    elements.statusDot.classList.remove('active');
    elements.statusDot.classList.add('error');
    elements.statusTextMain.textContent = 'No problem detected';
    currentProblem = null;
    currentSolution = null;
    currentProblemUrl = null;
    return;
  }

  // Check if the URL is whitelisted
  if (!isUrlWhitelisted(problem.url)) {
    showNotWhitelistedState(problem.url);
    currentProblem = null;
    currentSolution = null;
    currentProblemUrl = null;
    return;
  }

  // Hide not whitelisted card if it was showing
  hideNotWhitelistedState();

  // Store the URL we're about to display
  const displayingUrl = problem.url;
  currentProblemUrl = displayingUrl;
  currentProblem = problem;
  currentSolution = null;
  isProcessing = false;

  // Update UI
  elements.problemCard.classList.remove('hidden');
  elements.noProblemCard.classList.add('hidden');

  elements.platformBadge.textContent = problem.platform || 'Unknown';
  elements.problemTitle.textContent = problem.title || 'Untitled Problem';

  // Set language selector and badge
  const detectedLang = (problem.language || 'python').toLowerCase();
  const languageSelector = document.getElementById('languageSelector');
  let mappedLang = 'python';

  // Map detected language to our selector values
  if (detectedLang.includes('python')) mappedLang = 'python';
  else if (detectedLang.includes('javascript') || detectedLang === 'js') mappedLang = 'javascript';
  else if (detectedLang.includes('typescript') || detectedLang === 'ts') mappedLang = 'typescript';
  else if (detectedLang.includes('java')) mappedLang = 'java';
  else if (detectedLang.includes('c++') || detectedLang === 'cpp') mappedLang = 'cpp';
  else if (detectedLang.includes('c#') || detectedLang === 'csharp') mappedLang = 'csharp';
  else if (detectedLang.includes(' go')) mappedLang = 'go';
  else if (detectedLang.includes('rust')) mappedLang = 'rust';
  else if (detectedLang.includes('ruby')) mappedLang = 'ruby';
  else if (detectedLang.includes('php')) mappedLang = 'php';
  else if (detectedLang.includes('swift')) mappedLang = 'swift';
  else if (detectedLang.includes('kotlin')) mappedLang = 'kotlin';
  else if (detectedLang.includes('scala')) mappedLang = 'scala';
  else if (detectedLang === 'c') mappedLang = 'c';

  languageSelector.value = mappedLang;
  selectedLanguage = mappedLang;

  // Description
  if (problem.description) {
    elements.problemDescription.textContent = problem.description;
  }

  // Constraints
  if (problem.constraints) {
    document.getElementById('problemConstraints').classList.remove('hidden');
    elements.constraintsText.textContent = problem.constraints;
  } else {
    document.getElementById('problemConstraints').classList.add('hidden');
  }

  // Examples
  if (problem.examples) {
    document.getElementById('problemExamples').classList.remove('hidden');
    elements.examplesText.textContent = problem.examples;
  } else {
    document.getElementById('problemExamples').classList.add('hidden');
  }

  // Difficulty
  elements.difficultyBadge.textContent = problem.difficulty || 'Medium';
  elements.difficultyBadge.className = 'difficulty-badge';
  if (problem.difficulty?.toLowerCase() === 'easy') {
    elements.difficultyBadge.classList.add('easy');
  } else if (problem.difficulty?.toLowerCase() === 'hard') {
    elements.difficultyBadge.classList.add('hard');
  } else {
    elements.difficultyBadge.classList.add('medium');
  }

  // Update status
  elements.statusDot.classList.add('active');
  elements.statusDot.classList.remove('error');
  elements.statusTextMain.textContent = `Detected: ${problem.platform}`;

  // Load saved solution for this problem with the selected language (with stale callback check)
  if (problem.url) {
    loadSolution(problem.url, selectedLanguage, (stored) => {
      // Check if we're still displaying the same problem
      if (currentProblemUrl !== displayingUrl) {
        console.log('[SidePanel] Ignoring stale solution callback for:', problem.url);
        return;
      }

      if (stored && stored.solution) {
        // The stored solution matches our selected language, display it
        currentSolution = stored.solution;
        displaySolution(stored.solution);
        showStatus(`Loaded saved solution (${stored.language})`, 'success');
      } else {
        // No saved solution for this language, reset
        resetSolution();
      }
    });
  } else {
    resetSolution();
  }
}

// Reset Solution
function resetSolution() {
  elements.noSolution.classList.remove('hidden');
  elements.solutionLoading.classList.add('hidden');
  // Keep solutionHeader visible so user can switch languages
  // But hide remove/copy buttons when there's no solution
  elements.solutionHeader.classList.remove('hidden');
  elements.removeSolutionBtn.classList.add('hidden');
  elements.copySolutionBtn.classList.add('hidden');
  elements.solutionContent.classList.add('hidden');
  elements.solutionCode.textContent = '';
  elements.complexityText.textContent = '';
  elements.explanationContent.innerHTML = '<p class="placeholder-text">Solve the problem first to see detailed explanation.</p>';
}

// Refresh Detection
function refreshDetection() {
  elements.statusDot.classList.remove('active', 'error');
  elements.statusTextMain.textContent = 'Detecting...';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'detectCurrentPage' }, (response) => {
        if (response?.data) {
          displayProblem(response.data);
          showStatus('Problem detected!', 'success');
        } else {
          // No problem found - show no-problem state
          showStatus('No problem found on this page', 'error');
          elements.statusDot.classList.add('error');
          elements.statusTextMain.textContent = 'No problem detected';
          elements.problemCard.classList.add('hidden');
          elements.noProblemCard.classList.remove('hidden');
        }
      });
    }
  });
}

// Also add a function to refresh via background script (for tab changes)
function refreshViaBackground() {
  elements.statusDot.classList.remove('active', 'error');
  elements.statusTextMain.textContent = 'Detecting...';

  chrome.runtime.sendMessage({ action: 'refreshDetection' }, (response) => {
    if (response?.data) {
      displayProblem(response.data);
      showStatus('Problem detected!', 'success');
    } else {
      // No problem found - show no-problem state
      showStatus('No problem found on this page', 'error');
      elements.statusDot.classList.add('error');
      elements.statusTextMain.textContent = 'No problem detected';
      elements.problemCard.classList.add('hidden');
      elements.noProblemCard.classList.remove('hidden');
    }
  });
}

// Solve Problem
async function solveProblem() {
  if (!currentProblem) {
    showStatus('No problem to solve', 'error');
    return;
  }

  // Check if a profile is selected
  if (!selectedProfileId) {
    showStatus('Please create and select an AI profile', 'error');
    elements.settingsModal.classList.remove('hidden');
    return;
  }

  // Get the selected profile
  const profile = getProfile(selectedProfileId);
  if (!profile) {
    showStatus('Selected profile not found. Please select a valid profile.', 'error');
    return;
  }

  // Check if profile has API key (if needed)
  if (!profile.apiKey && profile.apiProvider !== 'local' && profile.apiProvider !== 'llama') {
    showStatus('Please configure API key for this profile', 'error');
    elements.settingsModal.classList.remove('hidden');
    return;
  }

  // Check if this profile is already busy
  getBusyProfiles((busyProfiles) => {
    if (busyProfiles[selectedProfileId]) {
      showStatus('This profile is currently solving. Please wait or choose another profile.', 'error');
      return;
    }

    // Proceed with solving
    performSolve(profile);
  });
}

async function performSolve(profile) {
  console.log('[SidePanel] performSolve called for profile:', selectedProfileId);

  // Create abort controller for this solve operation
  const controller = new AbortController();
  console.log('[SidePanel] Created AbortController for profile:', selectedProfileId);

  profileAbortControllers.set(selectedProfileId, {
    controller,
    cancelled: false,
    status: 'generating'
  });

  console.log('[SidePanel] AbortController stored in map. Map size:', profileAbortControllers.size);

  // Set this profile as busy
  setProfileBusy(selectedProfileId, true, {
    url: currentProblem.url,
    title: currentProblem.title,
    language: selectedLanguage,
    profileName: profile.name
  });

  // Capture the problem we're solving for (not just URL)
  const solvingProblem = { ...currentProblem };
  const solvingUrl = currentProblem.url;
  const solvingLanguage = selectedLanguage;

  // Show loading and set processing state
  elements.noSolution.classList.add('hidden');
  elements.solutionLoading.classList.remove('hidden');
  elements.solutionContent.classList.add('hidden');
  document.getElementById('solveBtn').disabled = true;
  isProcessing = true;

  try {
    console.log('[SidePanel] Calling generateSolution with signal...');
    const solution = await generateSolution(currentProblem, profile, controller.signal);

    // Check if was cancelled during generation
    const abortData = profileAbortControllers.get(selectedProfileId);
    if (abortData?.cancelled) {
      console.log('[SidePanel] Detected cancelled flag after generation completed');
      throw new Error('Cancelled by user');
    }

    // Always save the solution, even if we switched tabs
    storeSolution(solvingProblem, solution, solvingLanguage);

    // Only display if we're still on the same problem
    if (currentProblemUrl === solvingUrl) {
      currentSolution = solution;
      displaySolution(solution);
      showStatus('Solution generated!', 'success');
    } else {
      // Solution was saved but user is on a different tab now
      console.log('[SidePanel] Solution saved for:', solvingProblem.title);
      showStatus('Solution saved for previous tab', 'success');
    }
  } catch (error) {
    const abortData = profileAbortControllers.get(selectedProfileId);
    console.log('[SidePanel] Error in performSolve:', error.name, error.message);
    console.log('[SidePanel] AbortData:', abortData);

    if (error.name === 'AbortError' || abortData?.cancelled) {
      console.log('[SidePanel] Solve cancelled for profile:', selectedProfileId);

      // Mark as cancelled in busy profiles for tooltip display
      setProfileBusy(selectedProfileId, true, {
        url: solvingUrl,
        title: solvingProblem.title,
        language: solvingLanguage,
        profileName: profile.name,
        status: 'Cancelled',
        cancelled: true
      });

      showStatus('Solution generation cancelled', 'error');
      elements.noSolution.classList.remove('hidden');
    } else {
      console.error('Error solving problem:', error);
      showStatus(`Error: ${error.message}`, 'error');
      elements.noSolution.classList.remove('hidden');
    }
  } finally {
    // Clear the abort controller (but keep busy status if cancelled)
    const abortData = profileAbortControllers.get(selectedProfileId);
    const wasCancelled = abortData?.cancelled;
    console.log('[SidePanel] Finally block - wasCancelled:', wasCancelled);
    console.log('[SidePanel] Deleting AbortController from map for profile:', selectedProfileId);
    profileAbortControllers.delete(selectedProfileId);

    // Only clear busy status if not cancelled (cancelled profiles stay visible)
    if (!wasCancelled) {
      setProfileBusy(selectedProfileId, false);
    }

    // Only hide loading if we're still on the same problem
    if (currentProblemUrl === solvingUrl) {
      elements.solutionLoading.classList.add('hidden');
      document.getElementById('solveBtn').disabled = false;
    }
    isProcessing = false;
  }
}

// Generate Solution
async function generateSolution(problem, profile, abortSignal) {
  const prompt = buildPrompt(problem, profile);

  switch (profile.apiProvider) {
    case 'openai':
      return await callOpenAI(prompt, profile, abortSignal);
    case 'anthropic':
      return await callAnthropic(prompt, profile, abortSignal);
    case 'llama':
      return await callLlamaServer(prompt, profile, abortSignal);
    case 'local':
      return await callLocalLLM(prompt, profile, abortSignal);
    default:
      throw new Error('Unknown API provider');
  }
}

// Build Prompt
function buildPrompt(problem, profile) {
  let prompt = `You are an expert coding interviewer. Solve this programming problem step by step.\n\n`;
  prompt += `Platform: ${problem.platform}\n`;
  prompt += `Problem Title: ${problem.title}\n\n`;

  if (problem.description) {
    prompt += `Description:\n${problem.description}\n\n`;
  }

  if (problem.constraints) {
    prompt += `Constraints:\n${problem.constraints}\n\n`;
  }

  if (problem.examples) {
    prompt += `Examples:\n${problem.examples}\n\n`;
  }

  if (problem.starterCode) {
    prompt += `Starting Code:\n\`\`\`\n${problem.starterCode}\n\`\`\`\n\n`;
  }

  prompt += `Provide your response in this exact JSON format:
{
  "approach": "Your step-by-step approach explanation",
  "complexity": "Time: O(n), Space: O(1)",
  "code": "Complete, runnable solution code",
  "explanation": "Detailed explanation of key insights and edge cases"
}

Use the language specified (${selectedLanguage || 'Python'}) for the solution code. Make sure the code is complete and can be run directly.`;

  return prompt;
}

// OpenAI API
async function callOpenAI(prompt, profile, abortSignal) {
  console.log('[SidePanel] callOpenAI - abortSignal:', !!abortSignal);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey}`
      },
      body: JSON.stringify({
        model: profile.model || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: profile.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: profile.temperature ?? 0.2,
        max_tokens: profile.maxTokens ?? 4096,
        top_p: profile.topP ?? 1.0
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Try to parse JSON response
    try {
      return JSON.parse(content);
    } catch {
      // If not JSON, try to extract it
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Fallback: return parsed response
      return parseTextResponse(content);
    }
  } catch (error) {
    console.log('[SidePanel] callOpenAI error:', error.name, error.message);
    throw error; // Re-throw to be caught by performSolve
  }
}

// Anthropic Claude API
async function callAnthropic(prompt, profile, abortSignal) {
  console.log('[SidePanel] callAnthropic - abortSignal:', !!abortSignal);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': profile.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: profile.model || 'claude-3-5-sonnet-20241022',
        max_tokens: profile.maxTokens ?? 4096,
        temperature: profile.temperature ?? 0.2,
        top_p: profile.topP ?? 1.0,
        system: profile.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API error');
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Try to parse JSON response
    try {
      return JSON.parse(content);
    } catch {
      // If not JSON, try to extract it
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return parseTextResponse(content);
    }
  } catch (error) {
    console.log('[SidePanel] callAnthropic error:', error.name, error.message);
    throw error; // Re-throw to be caught by performSolve
  }
}

// Llama Server API (llama.cpp native format)
async function callLlamaServer(prompt, profile, abortSignal) {
  console.log('[SidePanel] callLlamaServer - abortSignal:', !!abortSignal);

  const systemPrompt = profile.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.';
  const fullPrompt = systemPrompt + '\n\n' + prompt;

  try {
    const response = await fetch(profile.llamaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        stream: false,
        temperature: profile.temperature ?? 0.2,
        max_tokens: profile.maxTokens ?? 4096,
        top_k: 40,
        top_p: profile.topP ?? 0.95,
        min_p: 0.05,
        repeat_penalty: 1,
        presence_penalty: 0,
        frequency_penalty: 0
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || error?.message || 'Llama server not responding. Make sure llama.cpp server is running.');
    }

    const data = await response.json();

    // Handle llama.cpp response format
    let content = '';
    if (data.choices?.[0]?.message?.content) {
      // OpenAI-compatible response format
      content = data.choices[0].message.content;
    } else if (data.content) {
      // Native llama.cpp response format
      content = data.content;
    } else if (data.response) {
      // Alternative response format
      content = data.response;
    }

    // Try to parse JSON response
    try {
      return JSON.parse(content);
    } catch {
      // If not JSON, try to extract it
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return parseTextResponse(content);
    }
  } catch (error) {
    console.log('[SidePanel] callLlamaServer error:', error.name, error.message);
    throw error; // Re-throw to be caught by performSolve
  }
}

// Local LLM (Ollama OpenAI-compatible endpoint)
async function callLocalLLM(prompt, profile, abortSignal) {
  console.log('[SidePanel] callLocalLLM - abortSignal:', !!abortSignal);

  const systemPrompt = profile.systemPrompt || 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.';
  const userPrompt = prompt + '\n\nRespond ONLY with valid JSON. Do not include any text before or after the JSON. JSON keys should be { approach, code, explanation }';

  try {
    const response = await fetch(profile.localUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: profile.model || 'llama3.1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: {
          temperature: profile.temperature ?? 0.2,
          num_predict: profile.maxTokens ?? 4096,
          top_p: profile.topP ?? 0.95
        }
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      throw new Error('Local LLM not responding. Make sure Ollama or similar is running.');
    }

    const data = await response.json();
    console.log(data);
    let content = data.choices?.[0]?.message?.content || data.response;

    if (!content) {
      throw new Error('Local LLM returned empty response');
    }

    console.log('[SidePanel] Ollama raw response (first 500 chars):', content.substring(0, 500));

    // Parse and clean the response
    const parsed = parseOllamaResponse(content);
    console.log('[SidePanel] Successfully parsed Ollama response');
    return parsed;
  } catch (error) {
    console.log('[SidePanel] callLocalLLM error:', error.name, error.message);
    throw error; // Re-throw to be caught by performSolve
  }
}

function parseCustomObject(input) {
  // CASE 1: If the input is a STRING, use Regex to parse the custom format
  if (typeof input === 'string') {
    // 1. Parse Approach
    const approachMatch = input.match(/"approach"\s*:\s*"([^"]+)"/);
    const approach = approachMatch ? approachMatch[1] : null;

    // 2. Parse Code (handling multiline """)
    var codeMatch = input.match(/"code"\s*:\s*"""([\s\S]*?)"""/);
    var code = codeMatch ? codeMatch[1].trim() : null;

    if(!code) {
      codeMatch = input.match(/"code"\s*:\s*"([\s\S]*?)"/);
      code = codeMatch ? codeMatch[1].trim() : null;
    }

    if(!code) {
      codeMatch = input.match(/"code"\s*:\s*`([\s\S]*?)`/);
      code = codeMatch ? codeMatch[1].trim() : null;
    }

    // 3. Parse Explanation
    var explanationMatch = input.match(/"explanation"\s*:\s*"([^"]+)"/);
    var explanation = explanationMatch ? explanationMatch[1] : null;

    if(!explanation) {
      explanationMatch = input.match(/"complexity"\s*:\s*"([^"]+)"/);
      explanation = codeMatch ? codeMatch[1].trim() : null;
    }


    return { approach, code, explanation };
  } 
  
  // CASE 2: If the input is already an OBJECT, access keys directly
  else if (typeof input === 'object' && input !== null) {
    let code = input.code;

    // If the code property still contains the triple quotes (e.g. '"""code"""'), strip them.
    if (typeof code === 'string' && code.startsWith('"""') && code.endsWith('"""')) {
      code = code.slice(3, -3).trim();
    }

    return {
      approach: input.approach,
      code: code,
      explanation: input.explanation
    };
  }

  return null;
}

// Parse Ollama response with various fallback strategies
function parseOllamaResponse(content) {
  console.log('[SidePanel] Raw Ollama response type:', typeof content);
  console.log('[SidePanel] Raw Ollama response (first 200 chars):', String(content).substring(0, 200));

  // Clean up the content before parsing
  let cleanedContent = content;

  // Remove any markdown code blocks
  cleanedContent = cleanedContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Trim whitespace and newlines
  cleanedContent = cleanedContent.trim();

  console.log('[SidePanel] Cleaned content type:', typeof cleanedContent);
  console.log('[SidePanel] Cleaned content (first 300 chars):', cleanedContent.substring(0, 300));

  let parsed = null;

  // Strategy 0: Try to Parse properly
  try{
    const parsed_ = parseCustomObject(content);
    console.log(parsed_);
    if (parsed_ && typeof parsed_ === 'object' && (parsed_.approach || parsed_.explanation) && parsed_.code) {
        console.log('[SidePanel] Strategy 0: Direct JSON parse succeeded');
        console.log('[SidePanel] Parsed object keys:', parsed_);        
        parsed = parsed_;
      } else {
        console.log('[SidePanel] Strategy 0 failed');
      }
  } catch(e) {
     console.log('[SidePanel] Strategy 0 failed:', e.message);
  }


  // Strategy 1: Direct JSON parse (for properly formatted responses)
  if (!parsed) {
    try {
      const tempParsed = JSON.parse(cleanedContent);
      if (tempParsed && typeof tempParsed === 'object' && (tempParsed.approach || tempParsed.code || tempParsed.explanation)) {
        console.log('[SidePanel] Strategy 1: Direct JSON parse succeeded');
        console.log('[SidePanel] Parsed object keys:', Object.keys(tempParsed));
        parsed = tempParsed;
      }
    } catch (e) {
      console.log('[SidePanel] Strategy 1 failed:', e.message);
    }
  }

  // Strategy 2: Handle escaped JSON strings (common in Ollama)
  // Ollama sometimes returns: "{\"approach\":\"...\",\"code\":\"...\"}"
  if (!parsed) {
    try {
      // Check if content looks like a stringified JSON (has escaped quotes)
      if (cleanedContent.includes('\\"') && !cleanedContent.includes('"') && cleanedContent.includes('{')) {
        // Try double-parse: first parse unescapes the string, second parse gets the object
        const unescaped = JSON.parse(cleanedContent);
        if (typeof unescaped === 'string') {
          const tempParsed = JSON.parse(unescaped);
          if (tempParsed && typeof tempParsed === 'object' && (tempParsed.approach || tempParsed.code || tempParsed.explanation)) {
            console.log('[SidePanel] Strategy 2a: Double-parse (stringified JSON) succeeded');
            parsed = tempParsed;
          }
        } else if (typeof unescaped === 'object' && (unescaped.approach || unescaped.code || unescaped.explanation)) {
          console.log('[SidePanel] Strategy 2b: Single-parse (already object) succeeded');
          parsed = unescaped;
        }
      }
    } catch (e) {
      console.log('[SidePanel] Strategy 2 failed:', e.message);
    }
  }

  // Strategy 3: Extract JSON from within text using brace counting
  if (!parsed) {
    try {
      const extracted = extractJSONWithBraceCounting(cleanedContent);
      if (extracted) {
        console.log('[SidePanel] Strategy 3: Extracted JSON (first 200 chars):', extracted.substring(0, 200));
        const tempParsed = JSON.parse(extracted);
        if (tempParsed && typeof tempParsed === 'object' && (tempParsed.approach || tempParsed.code || tempParsed.explanation)) {
          console.log('[SidePanel] Strategy 3: JSON extraction with brace counting succeeded');
          parsed = tempParsed;
        }
      }
    } catch (e) {
      console.log('[SidePanel] Strategy 3 failed:', e.message);
    }
  }

  // Strategy 4: Find JSON between first { and last }
  if (!parsed) {
    try {
      const firstBrace = cleanedContent.indexOf('{');
      const lastBrace = cleanedContent.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleanedContent.substring(firstBrace, lastBrace + 1);
        console.log('[SidePanel] Strategy 4: Extracted (first 200 chars):', extracted.substring(0, 200));
        const tempParsed = JSON.parse(extracted);
        if (tempParsed && typeof tempParsed === 'object' && (tempParsed.approach || tempParsed.code || tempParsed.explanation)) {
          console.log('[SidePanel] Strategy 4: First-to-last brace extraction succeeded');
          parsed = tempParsed;
        }
      }
    } catch (e) {
      console.log('[SidePanel] Strategy 4 failed:', e.message);
    }
  }

  // Strategy 5: Try parsing with simplified JSON (remove newlines, extra spaces)
  if (!parsed) {
    try {
      const simplified = cleanedContent
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      console.log('[SidePanel] Strategy 5: Simplified (first 200 chars):', simplified.substring(0, 200));
      const tempParsed = JSON.parse(simplified);
      if (tempParsed && typeof tempParsed === 'object' && (tempParsed.approach || tempParsed.code || tempParsed.explanation)) {
        console.log('[SidePanel] Strategy 5: Simplified JSON parse succeeded');
        parsed = tempParsed;
      }
    } catch (e) {
      console.log('[SidePanel] Strategy 5 failed:', e.message);
    }
  }

  // If we got a parsed result, clean up the fields
  if (parsed) {
    return cleanOllamaFields(parsed);
  }

  // All strategies failed - fall back to text parsing
  console.log('[SidePanel] All JSON strategies failed, falling back to text parsing');
  return parseTextResponse(cleanedContent);
}

// Clean up Ollama response fields by removing JSON artifacts
function cleanOllamaFields(parsed) {
  const cleaned = { ...parsed };

  // Helper function to unescape common JSON escape sequences
  const unescapeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  };

  // Clean up code field
  if (cleaned.code) {
    cleaned.code = cleaned.code
      .replace(/^:\s*"""/, '')      // Remove starting `: """`
      .replace(/""",?\s*$/, '')      // Remove ending `""",` or `"""`
      .replace(/^":\s*"""/, '')      // Remove starting `": """`
      .replace(/^"/, '')             // Remove starting quote
      .replace(/"$/, '')             // Remove ending quote
      .trim();
    // Unescape escape sequences in code
    cleaned.code = unescapeString(cleaned.code);
  }

  // Clean up approach field
  if (cleaned.approach) {
    cleaned.approach = cleaned.approach
      .replace(/^:\s*"/, '')         // Remove starting `: "`
      .replace(/",\s*$/, '')         // Remove ending `,`
      .replace(/^"/, '')             // Remove starting quote
      .replace(/"$/, '')             // Remove ending quote
      .trim();
    // Unescape escape sequences in approach
    cleaned.approach = unescapeString(cleaned.approach);
  }

  // Clean up explanation field - extract content after "explanation": "
  if (cleaned.explanation) {
    let explanation = cleaned.explanation;

    // Try to extract explanation from JSON format: "explanation": "content"
    const explanationMatch = explanation.match(/"explanation"\s*:\s*"([^"]*(?:"[^"]*)*)"/);
    if (explanationMatch) {
      explanation = explanationMatch[1];
    } else {
      // Look for "Detailed Explanation:" or "Explanation:" in text
      const detailedMatch = explanation.match(/(?:Detailed Explanation:|Explanation:)\s*([\s\S]*)/i);
      if (detailedMatch) {
        explanation = detailedMatch[1];
      } else {
        // Fallback: remove JSON artifacts
        explanation = explanation
          .replace(/^:\s*"/, '')         // Remove starting `: "`
          .replace(/",\s*$/, '')         // Remove ending `,`
          .replace(/^"/, '')             // Remove starting quote
          .replace(/"$/, '')             // Remove ending quote
          .trim();
      }
    }

    cleaned.explanation = explanation.trim();
    // Unescape escape sequences in explanation
    cleaned.explanation = unescapeString(cleaned.explanation);
  }

  // Clean up complexity field
  if (cleaned.complexity) {
    cleaned.complexity = cleaned.complexity
      .replace(/^:\s*"/, '')         // Remove starting `: "`
      .replace(/",\s*$/, '')         // Remove ending `,`
      .replace(/^"/, '')             // Remove starting quote
      .replace(/"$/, '')             // Remove ending quote
      .trim();
    // Unescape escape sequences in complexity
    cleaned.complexity = unescapeString(cleaned.complexity);
  }

  console.log('[SidePanel] Cleaned Ollama fields');
  return cleaned;
}

// Extract JSON using brace counting for accurate object boundaries
function extractJSONWithBraceCounting(content) {
  const startIndex = content.indexOf('{');
  if (startIndex === -1) return null;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
  }

  if (endIndex > startIndex) {
    return content.substring(startIndex, endIndex);
  }

  return null;
}

// Parse Text Response (fallback)
function parseTextResponse(text) {
  // Try to extract sections from text response
  const approachMatch = text.match(/(?:Approach|Approach:)\s*([\s\S]*?)(?=Complexity|$)/i);
  const complexityMatch = text.match(/(?:Complexity|Complexity:)\s*([\s\S]*?)(?=Code|$)/i);
  const codeMatch = text.match(/(?:Code|Solution|```\w*\n)([\s\S]*?)(?=Explanation|```|$)/i);

  const result = {
    approach: approachMatch?.[1]?.trim() || 'See explanation',
    complexity: complexityMatch?.[1]?.trim() || 'Not specified',
    code: codeMatch?.[1]?.trim() || text,
    explanation: text
  };

  // Apply the same cleanup as Ollama fields
  return cleanOllamaFields(result);
}

// Display Solution
function displaySolution(solution) {
  elements.noSolution.classList.add('hidden');
  elements.solutionHeader.classList.remove('hidden');
  elements.removeSolutionBtn.classList.remove('hidden');
  elements.copySolutionBtn.classList.remove('hidden');
  elements.solutionContent.classList.remove('hidden');

  // Update the solution language selector to match current language
  const solutionLanguageSelect = document.getElementById('solutionLanguageSelect');
  if (solutionLanguageSelect) {
    solutionLanguageSelect.value = selectedLanguage;
  }

  // Ensure solution has all required fields
  if (!solution) {
    solution = {};
  }

  // Format and display code (handle null/undefined)
  const formattedCode = formatCode(solution.code);
  elements.solutionCode.textContent = formattedCode;

  // Complexity
  elements.complexityText.textContent = solution.complexity || 'Not specified';

  // Explanation
  if (solution.explanation || solution.approach) {
    elements.explanationContent.innerHTML = `
      <div style="margin-bottom: 16px;">
        <strong style="color: var(--accent-primary);">Approach:</strong>
        <p style="color: var(--text-secondary); margin-top: 8px;">${escapeHtml(solution.approach || '')}</p>
      </div>
      <div>
        <strong style="color: var(--accent-primary);">Detailed Explanation:</strong>
        <p style="color: var(--text-secondary); margin-top: 8px; white-space: pre-wrap;">${escapeHtml(solution.explanation || '')}</p>
      </div>
    `;

    // Also update explanation tab content
    document.getElementById('explanationContent').innerHTML = `
      <div style="margin-bottom: 16px;">
        <strong style="color: var(--accent-primary);">Approach:</strong>
        <p style="color: var(--text-secondary); margin-top: 8px;">${escapeHtml(solution.approach || '')}</p>
      </div>
      <div>
        <strong style="color: var(--accent-primary);">Detailed Explanation:</strong>
        <p style="color: var(--text-secondary); margin-top: 8px; white-space: pre-wrap;">${escapeHtml(solution.explanation || '')}</p>
      </div>
    `;
  }
}

// Format Code
function formatCode(code) {
  // Handle null or undefined code
  if (!code) {
    return '// No code generated';
  }

  // Remove markdown code blocks if present
  code = code.replace(/```[\w]*\n?/g, '');

  // Unescape common JSON escape sequences
  // Handle escaped newlines, tabs, quotes, and backslashes
  code = code.replace(/\\n/g, '\n');
  code = code.replace(/\\t/g, '\t');
  code = code.replace(/\\"/g, '"');
  code = code.replace(/\\\\/g, '\\');

  // Clean up trailing artifacts from JSON extraction
  // Remove patterns like ["", "]", ["": ""], ["""], [:], etc.
  code = code.replace(/\s*\[\s*["']{0,2}["']{0,2}\s*\]\s*["']?\s*["']?\s*$/g, '');
  code = code.replace(/\s*\[\s*:\s*\]\s*$/g, '');
  code = code.replace(/\s*\[\s*""\s*\]\s*$/g, '');
  code = code.replace(/\s*\[\s*''\s*\]\s*$/g, '');
  code = code.replace(/\s*\[\s*\[\s*\]\s*\]\s*$/g, '');
  code = code.replace(/\s*["',\s*""",\s*''",\s*\[\s*\]\s*,\s*:\s*]\s*$/g, '');

  // Clean up common issues
  code = code.trim();

  return code;
}

// Copy Solution
async function copySolution() {
  const code = elements.solutionCode.textContent;
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    const btn = document.getElementById('copySolutionBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

// Remove Solution
async function removeSolution() {
  if (!currentProblem || !currentProblem.url) {
    showStatus('No problem to remove solution from', 'error');
    return;
  }

  const storageKey = getStorageKey(currentProblem.url, selectedLanguage);

  chrome.storage.local.get(['solutions'], (result) => {
    const solutions = result.solutions || {};

    if (solutions[storageKey]) {
      // Remove the solution
      delete solutions[storageKey];

      chrome.storage.local.set({ solutions }, () => {
        // Clear current solution from memory and UI
        currentSolution = null;
        resetSolution();
        showStatus('Solution removed', 'success');
        console.log('[SidePanel] Solution removed for:', currentProblem.url, 'language:', selectedLanguage);
      });
    } else {
      showStatus('No solution found to remove', 'error');
    }
  });
}

// Show Status
function showStatus(message, type = 'success') {
  elements.statusText.textContent = message;
  elements.statusBanner.className = `status-banner ${type}`;
  elements.statusBanner.classList.remove('hidden');

  setTimeout(() => {
    elements.statusBanner.classList.add('hidden');
  }, 3000);
}

// Show processing indicator with tooltip info
function showProcessingIndicator(url, problemTitle, language) {
  // Reset the manually closed flag when new activity starts
  tooltipManuallyClosed = false;
  // This function is kept for compatibility but now delegates to updateProcessingIndicator
  updateProcessingIndicator();
}

// Hide processing indicator
function hideProcessingIndicator() {
  // Check if there are still busy profiles before hiding
  getBusyProfiles((busyProfiles) => {
    if (Object.keys(busyProfiles).length === 0) {
      elements.processingIndicator.classList.add('hidden');
    } else {
      updateProcessingIndicator();
    }
  });
}

// Get busy timeout in milliseconds
function getBusyTimeoutMs() {
  return (generalSettings.busyTimeout || 5) * 60 * 1000;
}

// Check and clear stale busy profiles
function checkStaleBusyProfiles() {
  getBusyProfiles((busyProfiles) => {
    const now = Date.now();
    const timeout = getBusyTimeoutMs();
    const cancelledTimeout = 30000; // 30 seconds for cancelled profiles
    let hasChanges = false;

    Object.entries(busyProfiles).forEach(([profileId, info]) => {
      if (info.cancelled) {
        // Use shorter timeout for cancelled profiles (30 seconds)
        const cancelledTime = info.cancelledAt || info.timestamp;
        if (now - cancelledTime > cancelledTimeout) {
          console.log('[SidePanel] Removing stale cancelled profile:', profileId);
          delete busyProfiles[profileId];
          hasChanges = true;
        }
      } else {
        // Use normal timeout for active profiles
        if (now - info.timestamp > timeout) {
          console.log('[SidePanel] Removing stale active profile:', profileId);
          delete busyProfiles[profileId];
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      chrome.storage.local.set({ busyProfiles }, () => {
        updateProfileUI();
        updateProcessingIndicator();
      });
    }
  });
}

// Update processing indicator to show all busy profiles
function updateProcessingIndicator() {
  getBusyProfiles((busyProfiles) => {
    const profileIds = Object.keys(busyProfiles);

    // Check for stale entries first
    checkStaleBusyProfiles();

    if (profileIds.length === 0) {
      elements.processingIndicator.classList.remove('visible');
      elements.processingIndicator.classList.add('hidden');
      tooltipManuallyClosed = false; // Reset flag when all profiles are done
      return;
    }

    // Keep the indicator visible even when tooltip was manually closed
    elements.processingIndicator.classList.remove('hidden');

    // Respect user's manual close decision - don't auto-show tooltip, but update content
    if (!tooltipManuallyClosed) {
      elements.processingIndicator.classList.add('visible');
    }

    // Build the processing list HTML
    let html = '';
    profileIds.forEach(profileId => {
      const info = busyProfiles[profileId];
      const profile = getProfile(profileId);
      const profileName = profile ? profile.name : 'Unknown Profile';

      // Calculate time elapsed or remaining
      let timeString;
      if (info.cancelled) {
        // Show countdown until removal (30 seconds)
        const cancelledTime = info.cancelledAt || info.timestamp;
        const elapsedSinceCancel = Date.now() - cancelledTime;
        const remainingSeconds = 30 - Math.floor(elapsedSinceCancel / 1000);
        if (remainingSeconds > 0) {
          timeString = `Removing in ${remainingSeconds}s`;
        } else {
          timeString = 'Removing...';
        }
      } else {
        // Show elapsed time for active profiles
        const elapsed = Date.now() - info.timestamp;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
        timeString = elapsedMinutes > 0
          ? `${elapsedMinutes}m ${elapsedSeconds}s`
          : `${elapsedSeconds}s`;
      }

      // Truncate URL if too long
      let displayUrl = info.url || 'Unknown';
      if (displayUrl.length > 40) {
        displayUrl = displayUrl.substring(0, 37) + '...';
      }

      // Truncate title if too long
      let displayTitle = info.title || 'Unknown Problem';
      if (displayTitle.length > 30) {
        displayTitle = displayTitle.substring(0, 27) + '...';
      }

      // Format language for display
      const displayLanguage = info.language ? info.language.charAt(0).toUpperCase() + info.language.slice(1) : 'Unknown';

      // Get status (generating or cancelled)
      const status = info.status || 'Generating';

      html += `
        <div class="processing-profile-item ${info.cancelled ? 'cancelled' : ''}">
          <div class="processing-profile-name">
            ${escapeHtml(profileName)}
            <span class="processing-status ${info.cancelled ? 'cancelled' : ''}">${status}</span>
            <span class="processing-time">${timeString}</span>
          </div>
          <div class="processing-profile-details">
            <div class="tooltip-row">
              <span class="tooltip-label">Problem:</span>
              <span class="tooltip-value">${escapeHtml(displayTitle)}</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label">Language:</span>
              <span class="tooltip-value">${displayLanguage}</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label">URL:</span>
              <span class="tooltip-value">${escapeHtml(displayUrl)}</span>
            </div>
            ${!info.cancelled ? `
            <button class="force-stop-btn" data-profile-id="${escapeHtml(profileId)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
              Force Stop
            </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    elements.processingProfilesList.innerHTML = html;

    // Add event listeners to force stop buttons
    document.querySelectorAll('.force-stop-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const profileId = btn.getAttribute('data-profile-id');
        forceStopProfile(profileId);
      });
    });
  });
}

// Force stop a busy profile
function forceStopProfile(profileId) {
  console.log('[SidePanel] Force stop requested for profile:', profileId);

  // Get the abort controller for this profile
  const abortData = profileAbortControllers.get(profileId);

  console.log('[SidePanel] Abort data found:', !!abortData, 'Abort controllers in map:', profileAbortControllers.size);

  if (abortData) {
    // Mark as cancelled before aborting
    abortData.cancelled = true;
    abortData.status = 'Cancelled';

    console.log('[SidePanel] Aborting controller for profile:', profileId);
    // Abort the fetch request
    abortData.controller.abort();
    console.log('[SidePanel] Abort called for profile:', profileId);

    // Don't delete from map - let it be cleaned up naturally
    // This allows the abort to be checked later
  } else {
    console.log('[SidePanel] No abort controller found for profile:', profileId);
  }

  // Update the busy profile status to cancelled with a timestamp for cleanup
  getBusyProfiles((busyProfiles) => {
    if (busyProfiles[profileId]) {
      busyProfiles[profileId].status = 'Cancelled';
      busyProfiles[profileId].cancelled = true;
      busyProfiles[profileId].cancelledAt = Date.now(); // Track when it was cancelled
      chrome.storage.local.set({ busyProfiles }, () => {
        updateProfileUI();
        updateProcessingIndicator();
        showStatus('Profile force stopped - generation cancelled', 'success');
      });
    }
  });

  // Schedule removal of cancelled profile after 30 seconds
  setTimeout(() => {
    removeCancelledProfile(profileId);
  }, 30000);
}

// Remove a cancelled profile from busy list and free up the provider
function removeCancelledProfile(profileId) {
  getBusyProfiles((busyProfiles) => {
    const profile = busyProfiles[profileId];

    // Only remove if it's still marked as cancelled (wasn't restarted)
    if (profile && profile.cancelled) {
      console.log('[SidePanel] Removing cancelled profile after timeout:', profileId);
      delete busyProfiles[profileId];
      chrome.storage.local.set({ busyProfiles }, () => {
        updateProfileUI();
        updateProcessingIndicator();
        console.log('[SidePanel] Cancelled profile removed and provider freed:', profileId);
      });
    }
  });
}

// Update solve button state based on global solving state
function updateSolveButtonState(isSolving) {
  const solveBtn = document.getElementById('solveBtn');
  if (solveBtn) {
    solveBtn.disabled = !!isSolving;
  }
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== Solution Storage Functions ==========

// Generate a storage key for a problem URL and language
function getStorageKey(url, language) {
  // Remove query parameters and hash for consistent storage
  const cleanUrl = url.split('?')[0].split('#')[0];
  const lang = language || 'python';
  return `solution_${cleanUrl}_${lang}`;
}

// Store solution for current problem
function storeSolution(problem, solution, language) {
  if (!problem || !problem.url) return;

  const storageKey = getStorageKey(problem.url, language);
  const solutionData = {
    problem: problem,
    solution: solution,
    language: language,
    timestamp: Date.now(),
    url: problem.url
  };

  chrome.storage.local.get(['solutions'], (result) => {
    const solutions = result.solutions || {};
    solutions[storageKey] = solutionData;

    chrome.storage.local.set({ solutions }, () => {
      console.log('[SidePanel] Solution stored for:', problem.url, 'language:', language);
    });
  });
}

// Load solution for a problem URL and language
function loadSolution(url, language, callback) {
  const storageKey = getStorageKey(url, language);

  chrome.storage.local.get(['solutions'], (result) => {
    const solutions = result.solutions || {};
    const stored = solutions[storageKey];
    callback(stored || null);
  });
}

// Get all stored solutions
function getAllSolutions(callback) {
  chrome.storage.local.get(['solutions'], (result) => {
    const solutions = result.solutions || {};
    callback(solutions);
  });
}

// Export solutions to XML
function exportSolutionsToXML() {
  getAllSolutions((solutions) => {
    const solutionEntries = Object.values(solutions);

    if (solutionEntries.length === 0) {
      showStatus('No solutions to export', 'error');
      return;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<interview_solver_solutions>\n';
    xml += `  <export_date>${new Date().toISOString()}</export_date>\n`;
    xml += `  <total_solutions>${solutionEntries.length}</total_solutions>\n`;

    solutionEntries.forEach((entry) => {
      const problem = entry.problem || {};
      const solution = entry.solution || {};

      xml += '  <solution>\n';
      xml += `    <url>${escapeXML(entry.url || '')}</url>\n`;
      xml += `    <timestamp>${new Date(entry.timestamp).toISOString()}</timestamp>\n`;
      xml += `    <language>${escapeXML(entry.language || '')}</language>\n`;
      xml += '    <problem>\n';
      xml += `      <platform>${escapeXML(problem.platform || '')}</platform>\n`;
      xml += `      <title>${escapeXML(problem.title || '')}</title>\n`;
      xml += `      <difficulty>${escapeXML(problem.difficulty || '')}</difficulty>\n`;
      xml += `      <description>${escapeXML(problem.description || '')}</description>\n`;
      xml += `      <constraints>${escapeXML(problem.constraints || '')}</constraints>\n`;
      xml += `      <examples>${escapeXML(problem.examples || '')}</examples>\n`;
      xml += '    </problem>\n';
      xml += '    <solution_data>\n';
      xml += `      <approach>${escapeXML(solution.approach || '')}</approach>\n`;
      xml += `      <complexity>${escapeXML(solution.complexity || '')}</complexity>\n`;
      xml += `      <code>${escapeXML(solution.code || '')}</code>\n`;
      xml += `      <explanation>${escapeXML(solution.explanation || '')}</explanation>\n`;
      xml += '    </solution_data>\n';
      xml += '  </solution>\n';
    });

    xml += '</interview_solver_solutions>';

    // Create and trigger download
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_solver_solutions_${new Date().toISOString().split('T')[0]}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`Exported ${solutionEntries.length} solutions!`, 'success');
  });
}

// Escape special XML characters
function escapeXML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Clear all stored solutions
function clearAllSolutions() {
  if (confirm('Are you sure you want to delete all stored solutions?')) {
    chrome.storage.local.remove(['solutions'], () => {
      showStatus('All solutions cleared', 'success');
      currentSolution = null;
      resetSolution();
    });
  }
}

// Export profiles to JSON
function exportProfiles() {
  chrome.storage.local.get(['aiProfiles', 'customWhitelist'], (result) => {
    const aiProfiles = result.aiProfiles || [];

    // Filter out default profile (only export custom profiles)
    const customProfiles = aiProfiles.filter(p => p.id !== 'default');

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      profiles: customProfiles,
      customWhitelist: result.customWhitelist || []
    };

    // Create and trigger download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_solver_profiles_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`Exported ${customProfiles.length} profile(s)!`, 'success');
  });
}

// Import profiles from JSON
function importProfiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        // Validate basic structure
        if (!importData.profiles || !Array.isArray(importData.profiles)) {
          showStatus('Invalid import file format', 'error');
          return;
        }

        chrome.storage.local.get(['aiProfiles', 'customWhitelist'], (result) => {
          // Filter out null or invalid profiles from existing data
          const existingProfiles = (result.aiProfiles || []).filter(p => p && p.id);
          const existingWhitelist = result.customWhitelist || [];

          // Validate and filter imported profiles
          const validImportedProfiles = (importData.profiles || []).filter(p => p && p.id && p.name);

          if (validImportedProfiles.length === 0) {
            showStatus('No valid profiles found in import file', 'error');
            return;
          }

          // Ask user what to do with existing profiles
          const action = confirm(
            `Import ${validImportedProfiles.length} profile(s)\n\n` +
            `Click OK to ADD to existing profiles\n` +
            `Click Cancel to REPLACE all profiles`
          );

          let newProfiles;
          if (action) {
            // ADD: Merge profiles, generate new IDs for duplicates
            newProfiles = [...existingProfiles];
            validImportedProfiles.forEach(importedProfile => {
              // Check if profile with same name exists
              const existing = existingProfiles.find(p => p.name === importedProfile.name);
              if (existing) {
                // Generate new ID for imported profile
                importedProfile.id = 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              }
              newProfiles.push(importedProfile);
            });
          } else {
            // REPLACE: Use only imported profiles + default profile
            const existingDefault = existingProfiles.find(p => p.id === 'default' || p.isDefault);

            if (existingDefault) {
              // Keep existing default profile
              newProfiles = [existingDefault, ...importData.profiles];
            } else {
              // Create a new default profile if none exists
              const newDefault = {
                id: 'default',
                name: 'Default Profile',
                isDefault: true,
                apiProvider: 'openai',
                apiKey: '',
                localUrl: 'http://localhost:11434/v1/chat/completions',
                llamaUrl: 'http://localhost:8080/v1/chat/completions',
                model: 'gpt-4',
                temperature: 0.2,
                maxTokens: 4096,
                topP: 1.0,
                systemPrompt: 'You are an expert coding interviewer. Always respond with valid JSON in the exact format requested.'
              };
              newProfiles = [newDefault, ...validImportedProfiles];
            }
          }

          // Also import custom whitelist if present
          let newWhitelist = existingWhitelist;
          if (importData.customWhitelist && Array.isArray(importData.customWhitelist)) {
            const mergeWhitelist = confirm(
              `Import ${importData.customWhitelist.length} website(s) to whitelist?\n\n` +
              `Click OK to ADD to existing whitelist\n` +
              `Click Cancel to keep existing only`
            );

            if (mergeWhitelist) {
              // Merge whitelists, avoiding duplicates
              newWhitelist = [...new Set([...existingWhitelist, ...importData.customWhitelist])];
            }
          }

          // Save to storage
          chrome.storage.local.set({
            aiProfiles: newProfiles,
            customWhitelist: newWhitelist
          }, () => {
            // Update local state
            profiles = newProfiles;
            customWhitelist = newWhitelist;

            // Refresh UI
            updateProfilesList();
            updateWhitelistUI();
            updateProfileUI();

            showStatus(`Imported ${validImportedProfiles.length} profile(s) successfully!`, 'success');
          });
        });
      } catch (err) {
        console.error('Import error:', err);
        showStatus('Failed to import profiles. Invalid JSON file.', 'error');
      }
    };

    reader.readAsText(file);
  };

  input.click();
}

// Export whitelist to JSON
function exportWhitelist() {
  chrome.storage.local.get(['customWhitelist'], (result) => {
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      customWhitelist: result.customWhitelist || [],
      defaultWhitelist: defaultWhitelist // For reference
    };

    // Create and trigger download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_solver_whitelist_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`Exported ${(result.customWhitelist || []).length} website(s)!`, 'success');
  });
}

// Import whitelist from JSON
function importWhitelist() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        // Validate basic structure
        if (!importData.customWhitelist || !Array.isArray(importData.customWhitelist)) {
          showStatus('Invalid import file format', 'error');
          return;
        }

        chrome.storage.local.get(['customWhitelist'], (result) => {
          const existingWhitelist = result.customWhitelist || [];

          // Ask user what to do with existing whitelist
          const action = confirm(
            `Import ${importData.customWhitelist.length} website(s)\n\n` +
            `Click OK to ADD to existing whitelist\n` +
            `Click Cancel to REPLACE whitelist`
          );

          let newWhitelist;
          if (action) {
            // ADD: Merge whitelists, avoiding duplicates
            newWhitelist = [...new Set([...existingWhitelist, ...importData.customWhitelist])];
          } else {
            // REPLACE: Use only imported whitelist
            newWhitelist = importData.customWhitelist;
          }

          // Save to storage
          chrome.storage.local.set({ customWhitelist: newWhitelist }, () => {
            // Update local state
            customWhitelist = newWhitelist;

            // Refresh UI
            updateWhitelistUI();

            showStatus(`Imported ${importData.customWhitelist.length} website(s) successfully!`, 'success');
          });
        });
      } catch (err) {
        console.error('Import error:', err);
        showStatus('Failed to import whitelist. Invalid JSON file.', 'error');
      }
    };

    reader.readAsText(file);
  };

  input.click();
}
