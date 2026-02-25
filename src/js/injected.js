// Injected Script - Runs in page context
// This script helps prevent focus detection by the webpage

(function() {
  'use strict';

  console.log('[CodeSolver Pro] Focus protection active');

  // Track if side panel is open - start as true since extension is installed
  let isSidePanelOpen = true;
  let lastFocusTime = Date.now();

  // Store original focus/blur handlers
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalOnBlur = Object.getOwnPropertyDescriptor(Document.prototype, 'onblur');
  const originalOnFocus = Object.getOwnPropertyDescriptor(Document.prototype, 'onfocus');

  // Intercept blur events that might be caused by side panel
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'blur' || type === 'focusout') {
      const wrappedListener = function(event) {
        // If side panel is open, block blur events from the page
        if (isSidePanelOpen && (type === 'blur' || type === 'focusout')) {
          console.log('[CodeSolver Pro] Blocked blur event - side panel is open');
          event.stopPropagation();
          event.stopImmediatePropagation();
          event.preventDefault();
          return false;
        }

        // Check if the event target is the document/window
        if ((event.target === document || event.target === window) && !event.isTrusted) {
          // Let through synthetic events (like our own)
          return listener.apply(this, arguments);
        }

        // Check if the new focus target is within our extension
        setTimeout(() => {
          const focusedWindow = document.hasFocus();

          // If focus moved to something that's not part of the page's content
          // and side panel was recently used, it might be the side panel - don't notify the page
          if (!focusedWindow && (Date.now() - lastFocusTime < 3000)) {
            console.log('[CodeSolver Pro] Blocked blur event - recent focus change');
            return;
          }

          // Otherwise, let the event through
          return listener.apply(this, arguments);
        }, 0);
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Override document.hasFocus to always return true when side panel is open
  const originalHasFocus = document.hasFocus.bind(document);
  document.hasFocus = function() {
    if (isSidePanelOpen) {
      return true;
    }
    return originalHasFocus();
  };

  // Override document.activeElement to return the last focused element
  let lastActiveElement = document.activeElement;
  const originalActiveElementGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');

  try {
    Object.defineProperty(document, 'activeElement', {
      get: function() {
        if (isSidePanelOpen && lastActiveElement) {
          return lastActiveElement;
        }
        return originalActiveElementGetter ? originalActiveElementGetter.get.call(document) : document.body;
      },
      configurable: true
    });
  } catch (e) {
    console.warn('[CodeSolver Pro] Could not override activeElement:', e);
  }

  // Track active element changes
  document.addEventListener('focus', (e) => {
    if (e.target && e.target !== document && e.target !== window) {
      lastActiveElement = e.target;
      lastFocusTime = Date.now();
    }
  }, true);

  // Intercept visibility change (some sites use this to detect tab switching)
  try {
    Object.defineProperty(document, 'hidden', {
      get: function() {
        // Always return false (not hidden) when side panel is open
        if (isSidePanelOpen) {
          return false;
        }
        return document.hidden;
      },
      configurable: false
    });

    Object.defineProperty(document, 'visibilityState', {
      get: function() {
        // Always return visible when side panel is open
        if (isSidePanelOpen) {
          return 'visible';
        }
        return document.visibilityState;
      },
      configurable: false
    });
  } catch (e) {
    console.warn('[CodeSolver Pro] Could not override visibility API:', e);
  }

  // Intercept page visibility API events
  document.addEventListener('visibilitychange', function(event) {
    // Prevent the page from knowing when visibility changes
    if (isSidePanelOpen) {
      console.log('[CodeSolver Pro] Blocked visibilitychange event');
      event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
      return false;
    }
  }, true);

  // Listen for messages from extension
  window.addEventListener('message', function(event) {
    // Verify the message is from our extension
    if (event.data && event.data.source === 'code-solver-extension') {
      if (event.data.type === 'CODE_SOLVER_PANEL_OPEN') {
        isSidePanelOpen = true;
        lastFocusTime = Date.now();
        console.log('[CodeSolver Pro] Side panel opened, focus protection active');

        // Dispatch a fake focus event to keep page thinking it has focus
        const fakeFocusEvent = new FocusEvent('focus', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        document.dispatchEvent(fakeFocusEvent);
      }

      if (event.data.type === 'CODE_SOLVER_PANEL_CLOSE') {
        isSidePanelOpen = false;
        console.log('[CodeSolver Pro] Side panel closed');
      }

      if (event.data.type === 'CODE_SOLVER_PANEL_FOCUS') {
        lastFocusTime = Date.now();
        lastActiveElement = event.data.element || document.activeElement;
        console.log('[CodeSolver Pro] Panel interaction, maintaining focus');
      }
    }
  });

  // Also intercept onblur/onfocus property assignments
  try {
    Object.defineProperty(document, 'onblur', {
      set: function(value) {
        // Don't allow setting blur handlers when side panel is open
        if (isSidePanelOpen) {
          console.log('[CodeSolver Pro] Blocked onblur handler assignment - side panel open');
          return;
        }
        originalOnBlur?.set?.call(this, value);
      },
      get: function() {
        return originalOnBlur?.get?.call(this);
      },
      configurable: true
    });

    Object.defineProperty(window, 'onblur', {
      set: function(value) {
        console.log('[CodeSolver Pro] Blocked window.onblur handler assignment');
      },
      get: function() {
        return null;
      },
      configurable: false
    });
  } catch (e) {
    console.warn('[CodeSolver Pro] Could not override onblur:', e);
  }

  // Prevent Page Visibility API from detecting the change
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function(event) {
    if (event.type === 'visibilitychange' && isSidePanelOpen) {
      console.log('[CodeSolver Pro] Blocked visibilitychange event');
      return true;
    }
    // Block blur and focusout events when protection is active
    if ((event.type === 'blur' || event.type === 'focusout') && isSidePanelOpen) {
      console.log('[CodeSolver Pro] Blocked blur/focusout event at dispatch');
      return true;
    }
    return originalDispatchEvent.call(this, event);
  };

  console.log('[CodeSolver Pro] Focus protection initialized');

})();
