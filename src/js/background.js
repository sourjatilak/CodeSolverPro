// Background service worker
// Handles side panel lifecycle and communication

// Store problems per tab
const tabProblems = new Map();

// Initialize side panel on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('CodeSolver Pro installed');

  // Set default side panel options
  chrome.sidePanel.setOptions({
    enabled: true
  });

  // Inject content scripts into all already-open tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        // Inject content script into existing tab
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(err => {
          // Tab might be restricted or closed, ignore error
          console.log('[CodeSolver Pro] Could not inject into tab:', tab.id, err.message);
        });
        console.log('[CodeSolver Pro] Injected content script into existing tab:', tab.id);
      }
    });
  });
});

// Handle extension icon click - open side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for tab activation - switch to that tab's problem
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('[CodeSolver Pro] Tab activated:', activeInfo.tabId);

  // Notify side panel to refresh with this tab's problem
  const problem = tabProblems.get(activeInfo.tabId);

  // Always update storage with current tab's problem (or null if none)
  if (problem) {
    chrome.storage.local.set({ currentProblem: problem });
  } else {
    // No problem for this tab, explicitly remove from storage
    chrome.storage.local.remove('currentProblem');
  }

  chrome.runtime.sendMessage({
    action: 'tabChanged',
    tabId: activeInfo.tabId,
    problem: problem || null,
    url: problem ? problem.url : null
  }).catch(() => {
    // Side panel might not be open, ignore error
  });
});

// Listen for tab updates (navigation, loading complete)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only run when page is fully loaded
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('[CodeSolver Pro] Tab updated:', tabId, tab.url);

    // Clear stored problem for this tab when navigating
    tabProblems.delete(tabId);
    chrome.storage.local.remove('currentProblem');

    // Notify side panel that tab was updated with tabId
    chrome.runtime.sendMessage({
      action: 'tabUpdated',
      tabId: tabId,
      url: tab.url
    }).catch(() => {});

    // Trigger detection in the content script
    chrome.tabs.sendMessage(tabId, { action: 'detectCurrentPage' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script might not be ready or page doesn't support it
        console.log('[CodeSolver Pro] Could not send message to tab:', chrome.runtime.lastError.message);
        return;
      }
      if (response?.data) {
        tabProblems.set(tabId, response.data);
        chrome.storage.local.set({ currentProblem: response.data });
      }
    });
  }
});

// Listen for tab removal - clean up stored problems
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('[CodeSolver Pro] Tab removed:', tabId);
  tabProblems.delete(tabId);
});

// Combined message listener for all actions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (request.action) {
    case 'detectQuestion':
      // Store problem associated with the sender's tab
      if (tabId && request.data) {
        tabProblems.set(tabId, request.data);
      }
      // Forward to side panel
      chrome.runtime.sendMessage({
        action: 'questionDetected',
        data: request.data,
        tabId: tabId
      }).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'solveProblem':
      solveCodingProblem(request.data).then(solution => {
        sendResponse({ success: true, solution });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // Keep message channel open for async response

    case 'openSidePanel':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id });
        }
      });
      sendResponse({ success: true });
      break;

    case 'getCurrentTabProblem':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const problem = tabProblems.get(tabs[0].id);
          sendResponse({ problem: problem || null });
        } else {
          sendResponse({ problem: null });
        }
      });
      return true;

    case 'refreshDetection':
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]) {
          const tab = tabs[0];

          // First, try to send message to existing content script
          const trySend = () => {
            return new Promise((resolve) => {
              chrome.tabs.sendMessage(tab.id, { action: 'detectCurrentPage' }, (response) => {
                if (chrome.runtime.lastError) {
                  resolve(null); // Content script not ready
                } else {
                  resolve(response);
                }
              });
            });
          };

          let response = await trySend();

          // If content script not ready, inject it and try again
          if (!response) {
            console.log('[CodeSolver Pro] Content script not ready, injecting...');
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
              });

              // Wait a bit for script to initialize
              await new Promise(r => setTimeout(r, 100));

              // Try detection again
              response = await trySend();
            } catch (err) {
              console.log('[CodeSolver Pro] Could not inject content script:', err.message);
            }
          }

          if (response?.data) {
            tabProblems.set(tab.id, response.data);
            chrome.storage.local.set({ currentProblem: response.data });
            sendResponse({ success: true, data: response.data });
          } else {
            sendResponse({ success: false, error: 'No problem detected' });
          }
        }
      });
      return true;

    case 'storeProblem':
      if (tabId && request.data) {
        tabProblems.set(tabId, request.data);
        chrome.storage.local.set({ currentProblem: request.data });
      }
      break;

    case 'getProblem':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const problem = tabProblems.get(tabs[0].id);
          sendResponse({ problem: problem || null });
        } else {
          sendResponse({ problem: null });
        }
      });
      return true;
  }
});

// Problem solving function - integrate with your AI API
async function solveCodingProblem(problemData) {
  // This is where you'd integrate with:
  // - OpenAI API
  // - Anthropic Claude API
  // - Local LLM (Ollama, LM Studio)
  // - Or any other AI service

  const prompt = `
You are an expert coding interviewer. Solve this programming problem:

Platform: ${problemData.platform || 'Unknown'}
Problem: ${problemData.title}
Description: ${problemData.description}
${problemData.constraints ? 'Constraints: ' + problemData.constraints : ''}
${problemData.examples ? 'Examples: ' + problemData.examples : ''}
${problemData.starterCode ? 'Starting Code:\n' + problemData.starterCode : ''}

Provide:
1. Approach/Explanation
2. Time & Space Complexity
3. Complete solution code (match the language of the starter code)
4. Edge cases to consider
`;

  // Example: Using OpenAI (you'll need to add API key handling)
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': 'Bearer YOUR_API_KEY'
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4',
  //     messages: [{ role: 'user', content: prompt }]
  //   })
  // });

  // For now, return a placeholder
  return {
    approach: "AI solving not configured. Please add your API key in settings.",
    complexity: "N/A",
    code: "// Add your OpenAI/Anthropic API key to get AI solutions\nfunction solve() {\n    // Solution will appear here\n}",
    explanation: "Configure the API in background.js to enable AI-powered solutions."
  };
}

// Export for use in other modules
export { solveCodingProblem };
