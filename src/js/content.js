// Content Script - Detects coding interview questions on the page
// Runs in the context of web pages

(function() {
  'use strict';

  console.log('[CodeSolver Pro] Content script loaded');

  // Inject focus protection script into page context
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = function() {
    this.remove();
    // Immediately notify injected script that panel can be opened
    window.postMessage({
      type: 'CODE_SOLVER_PANEL_OPEN',
      source: 'code-solver-extension'
    }, '*');
    console.log('[CodeSolver Pro] Focus protection script injected and activated');
  };

  // Platform detection patterns
  const platforms = {
    leetcode: {
      patterns: ['leetcode.com', 'leetcode.cn'],
      detect: detectLeetCode,
      name: 'LeetCode'
    },
    hackerrank: {
      patterns: ['hackerrank.com'],
      detect: detectHackerRank,
      name: 'HackerRank'
    },
    codesignal: {
      patterns: ['codesignal.com'],
      detect: detectCodeSignal,
      name: 'CodeSignal'
    },
    codeforces: {
      patterns: ['codeforces.com'],
      detect: detectCodeforces,
      name: 'Codeforces'
    },
    codewars: {
      patterns: ['codewars.com'],
      detect: detectCodewars,
      name: 'Codewars'
    },
    interviewbit: {
      patterns: ['interviewbit.com'],
      detect: detectInterviewBit,
      name: 'InterviewBit'
    },
    hackerearth: {
      patterns: ['hackerearth.com'],
      detect: detectHackerEarth,
      name: 'HackerEarth'
    },
    algoexpert: {
      patterns: ['algoexpert.io'],
      detect: detectAlgoExpert,
      name: 'AlgoExpert'
    },
    binarysearch: {
      patterns: ['binarysearch.com'],
      detect: detectBinarySearch,
      name: 'BinarySearch'
    },
    cses: {
      patterns: ['cses.fi'],
      detect: detectCSES,
      name: 'CSES'
    },
    atcoder: {
      patterns: ['atcoder.jp'],
      detect: detectAtCoder,
      name: 'AtCoder'
    },
    neetcode: {
      patterns: ['neetcode.io'],
      detect: detectGenericCodingPage,
      name: 'NeetCode.io'
    }
  };

  // Detect current platform
  let currentPlatform = null;
  const hostname = window.location.hostname;

  for (const [key, platform] of Object.entries(platforms)) {
    if (platform.patterns.some(p => hostname.includes(p))) {
      currentPlatform = platform;
      break;
    }
  }

  if (!currentPlatform) {
    // Generic detection for unknown platforms
    detectGenericCodingPage();
  } else {
    console.log(`[CodeSolver Pro] Detected platform: ${currentPlatform.name}`);
    const problemData = currentPlatform.detect();
    if (problemData) {
      sendProblemToBackground(problemData);
    }
  }

  // Watch for page changes (SPAs)
  observePageChanges();

  // ========== Platform-specific detectors ==========

  function detectLeetCode() {
    try {
      // For new LeetCode UI (Next.js based)
      let title = '';

      // Try multiple selector strategies
      const titleSelectors = [
        'h1[class*="text"]',
        '[data-cy="question-title"]',
        'h1',
        '.elf-markdown h1',
        'a[href*="/problems/"]',
        '[class*="title"]'
      ];

      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el?.textContent) {
          const text = el.textContent.trim();
          // Filter out non-title text
          if (text && text.length > 2 && text.length < 200 && !text.includes('Submissions') && !text.includes('Discuss')) {
            title = text;
            break;
          }
        }
      }

      // Get problem title from URL if not found in DOM
      if (!title) {
        const urlMatch = window.location.pathname.match(/\/problems\/([^\/]+)/);
        if (urlMatch) {
          title = urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
      }

      console.log('[CodeSolver Pro] LeetCode title found:', title);

      // Get the full problem content element
      const contentSelectors = [
        '[data-cy="question-description"]',
        'div[class*="content"][class*="description"]',
        '[class*="problemContent"]',
        '[class*="question-content"]',
        'article',
        'div[class*="markdown"]'
      ];

      let contentElement = null;
      for (const selector of contentSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          contentElement = el;
          console.log('[CodeSolver Pro] Found content element with selector:', selector);
          break;
        }
      }

      if (!contentElement) {
        console.log('[CodeSolver Pro] No content element found, trying fallback');
        // Fallback: get text from body
        contentElement = document.body;
      }

      // Parse the problem content into sections
      const parsedContent = parseLeetCodeContent(contentElement);

      // Get difficulty
      const difficulty = detectDifficultyLeetCode();

      // Try to get code from editor (Monaco or textarea)
      let starterCode = '';
      const codeSelectors = [
        'textarea[class*="editor"]',
        '.monaco-editor textarea',
        'input[value*="class Solution"]',
        'input[value*="def "]',
        'input[value*="function "]',
        '[class*="code-editor"] textarea'
      ];

      for (const selector of codeSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          starterCode = el.value || el.textContent || el.getAttribute('value') || '';
          if (starterCode.length > 10) break;
        }
      }

      // Detect language
      const language = detectLeetCodeLanguage();

      const result = {
        platform: 'LeetCode',
        title: title || 'Unknown Problem',
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: starterCode,
        language: language,
        url: window.location.href,
        difficulty: difficulty
      };

      console.log('[CodeSolver Pro] LeetCode detection result:', {
        title: result.title,
        descriptionLength: result.description.length,
        examplesLength: result.examples.length,
        constraintsLength: result.constraints.length
      });

      return result;
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting LeetCode problem:', error);
      return null;
    }
  }

  // Parse LeetCode problem content into structured sections
  function parseLeetCodeContent(contentElement) {
    const result = {
      description: '',
      examples: '',
      constraints: ''
    };

    if (!contentElement) {
      console.log('[CodeSolver Pro] parseLeetCodeContent: No content element provided');
      return result;
    }

    let fullText = contentElement.innerText || contentElement.textContent || '';

    if (!fullText || fullText.length < 10) {
      console.log('[CodeSolver Pro] parseLeetCodeContent: Empty or too short content');
      return result;
    }

    console.log('[CodeSolver Pro] parseLeetCodeContent: Parsing content, length:', fullText.length);

    // Split content into sections
    // LeetCode structure: Description -> Examples -> Constraints -> (optional) Follow-up

    // Find the Examples section
    const examplesPatterns = [
      /\n\s*Examples\s*[:\n]/i,
      /\n\s*Example\s*[:\n]/i,
      /\nExample\s*\d+[:\n]/i
    ];

    let examplesIndex = -1;
    for (const pattern of examplesPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        examplesIndex = match.index;
        console.log('[CodeSolver Pro] Found Examples at index:', examplesIndex);
        break;
      }
    }

    // Find the Constraints section
    const constraintsPatterns = [
      /\n\s*Constraints\s*[:\n]/i,
      /\n\s*Constraints\n/i
    ];

    let constraintsIndex = -1;
    for (const pattern of constraintsPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        constraintsIndex = match.index;
        console.log('[CodeSolver Pro] Found Constraints at index:', constraintsIndex);
        break;
      }
    }

    // Extract description (everything before Examples or Constraints)
    if (examplesIndex !== -1) {
      result.description = fullText.substring(0, examplesIndex).trim();
    } else if (constraintsIndex !== -1) {
      result.description = fullText.substring(0, constraintsIndex).trim();
    } else {
      result.description = fullText.trim();
    }

    // Clean up description - remove any trailing empty lines
    result.description = result.description.replace(/\n\s*$/, '').trim();

    console.log('[CodeSolver Pro] Description length:', result.description.length);

    // Extract examples (between Examples and Constraints)
    if (examplesIndex !== -1) {
      const examplesStart = examplesIndex;
      const examplesEnd = constraintsIndex !== -1 ? constraintsIndex : fullText.length;

      let examplesText = fullText.substring(examplesStart, examplesEnd).trim();

      // Extract structured examples
      result.examples = extractLeetCodeExamples(contentElement, examplesText);
      console.log('[CodeSolver Pro] Examples length:', result.examples.length);
    }

    // Extract constraints (after Constraints section)
    if (constraintsIndex !== -1) {
      const constraintsText = fullText.substring(constraintsIndex).trim();

      // Remove the "Constraints:" header and clean up
      let constraints = constraintsText.replace(/^Constraints\s*[:\n]*/i, '').trim();

      // Also extract any "Follow-up" section
      const followUpMatch = constraints.match(/(?:\n|^)\s*(?:Follow-up\s*[:\n]|Follow up\s*[:\n]|Followup\s*[:\n])/i);
      if (followUpMatch) {
        // Split at follow-up
        const mainConstraints = constraints.substring(0, followUpMatch.index).trim();
        const followUp = constraints.substring(followUpMatch.index).trim();

        // Add follow-up to constraints with a separator
        result.constraints = mainConstraints + '\n\nFollow-up:\n' + followUp.replace(/^Follow-up\s*[:\n]*/i, '').trim();
      } else {
        result.constraints = constraints;
      }
      console.log('[CodeSolver Pro] Constraints length:', result.constraints.length);
    }

    return result;
  }

  // Extract examples from LeetCode content element
  function extractLeetCodeExamples(contentElement, examplesText) {
    let examples = '';

    if (!contentElement) {
      return examples;
    }

    // Try to extract examples from DOM elements for better formatting
    const exampleElements = contentElement.querySelectorAll('[class*="example"]');

    if (exampleElements.length > 0) {
      exampleElements.forEach(el => {
        const text = el.textContent || el.innerText;
        if (text && text.trim().length > 5) {
          examples += text.trim() + '\n\n';
        }
      });
    } else {
      // Fallback to text-based extraction
      examples = examplesText;
    }

    // If still empty, try to find example blocks
    if (!examples || examples.length < 10) {
      // Look for pre/code blocks that contain Input/Output
      const codeBlocks = contentElement.querySelectorAll('pre, code, blockquote');
      codeBlocks.forEach(block => {
        const text = block.textContent || block.innerText;
        if (text && (text.includes('Input:') || text.includes('Output:') || text.includes('Explanation:'))) {
          examples += text.trim() + '\n\n';
        }
      });
    }

    // Clean up examples
    examples = examples
      .replace(/^Examples?\s*[:\n]*/i, '')
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return examples;
  }

  function detectLeetCodeLanguage() {
    // Check language selector or button
    const langSelectors = [
      'button[class*="lang"]',
      '[data-cy="language-selector"]',
      'select[class*="lang"]',
      '.language-selector'
    ];

    for (const selector of langSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent || el.value || el.getAttribute('data-value');
        if (text) {
          const lang = text.toLowerCase().trim();
          if (lang.includes('python')) return 'python';
          if (lang.includes('java')) return 'java';
          if (lang.includes('javascript') || lang.includes('js')) return 'javascript';
          if (lang.includes('c++')) return 'cpp';
          if (lang.includes('c#')) return 'csharp';
          if (lang.includes('go')) return 'go';
          if (lang.includes('rust')) return 'rust';
          if (lang.includes('ruby')) return 'ruby';
          if (lang.includes('scala')) return 'scala';
          if (lang.includes('kotlin')) return 'kotlin';
          if (lang.includes('typescript') || lang.includes('ts')) return 'typescript';
        }
      }
    }
    return 'python';
  }

  function detectDifficultyLeetCode() {
    const difficultySelectors = [
      '[data-cy="difficulty"]',
      'span[class*="difficulty"]',
      'div[class*="difficulty"]',
      '[class*="Diff"]'
    ];

    for (const selector of difficultySelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent) {
        const text = el.textContent.trim().toLowerCase();
        if (text.includes('easy')) return 'Easy';
        if (text.includes('medium')) return 'Medium';
        if (text.includes('hard')) return 'Hard';
      }
    }

    // Check page text for difficulty
    const bodyText = document.body.innerText;
    const easyMatch = bodyText.match(/difficulty[:\s]*easy/i);
    const mediumMatch = bodyText.match(/difficulty[:\s]*medium/i);
    const hardMatch = bodyText.match(/difficulty[:\s]*hard/i);

    if (hardMatch) return 'Hard';
    if (mediumMatch) return 'Medium';
    if (easyMatch) return 'Easy';

    return '';
  }

  function detectHackerRank() {
    try {
      const title = document.querySelector('.problem-header h1, .challenge-title h1, h1')?.textContent?.trim() || '';

      // Get the problem statement element for structured parsing
      const statementElement = document.querySelector('.problem-statement, .challenge-body, .content');

      // Parse the HackerRank content into sections
      const parsedContent = parseHackerRankContent(statementElement);

      // Get starter code from editor
      const codeEditor = document.querySelector('textarea[name="code"]') ||
                        document.querySelector('.CodeMirror-code') ||
                        document.querySelector('input[type="hidden"][value*="def"]');
      let starterCode = codeEditor?.value || codeEditor?.textContent || '';

      return {
        platform: 'HackerRank',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: starterCode,
        language: detectLanguageFromCode(starterCode) || 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting HackerRank problem:', error);
      return null;
    }
  }

  // Parse HackerRank problem content into structured sections
  function parseHackerRankContent(contentElement) {
    const result = {
      description: '',
      examples: '',
      constraints: ''
    };

    if (!contentElement) {
      return result;
    }

    const fullText = contentElement.innerText || '';

    // HackerRank structure varies but typically has:
    // Problem Description -> Input Format -> Output Format -> (optional) Examples -> Constraints

    // Find the Input Format section
    const inputFormatPatterns = [
      /\n\s*Input Format\s*[:\n]/i,
      /\n\s*Input\s*[:\n]/i
    ];

    let inputFormatIndex = -1;
    for (const pattern of inputFormatPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        inputFormatIndex = match.index;
        break;
      }
    }

    // Find the Output Format section
    const outputFormatPatterns = [
      /\n\s*Output Format\s*[:\n]/i,
      /\n\s*Output\s*[:\n]/i
    ];

    let outputFormatIndex = -1;
    for (const pattern of outputFormatPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        outputFormatIndex = match.index;
        break;
      }
    }

    // Find the Examples section
    const examplesPatterns = [
      /\n\s*Sample Input\s*[:\n]/i,
      /\n\s*Sample Output\s*[:\n]/i,
      /\n\s*Example\s*[:\n]/i,
      /\n\s*Examples\s*[:\n]/i
    ];

    let examplesIndex = -1;
    for (const pattern of examplesPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        examplesIndex = match.index;
        break;
      }
    }

    // Find the Constraints section
    const constraintsPatterns = [
      /\n\s*Constraints\s*[:\n]/i
    ];

    let constraintsIndex = -1;
    for (const pattern of constraintsPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        constraintsIndex = match.index;
        break;
      }
    }

    // Extract description (everything before Input Format or first section)
    let descriptionEnd = inputFormatIndex !== -1 ? inputFormatIndex :
                         outputFormatIndex !== -1 ? outputFormatIndex :
                         examplesIndex !== -1 ? examplesIndex :
                         constraintsIndex !== -1 ? constraintsIndex : fullText.length;

    result.description = fullText.substring(0, descriptionEnd).trim();

    // Include Input and Output Format in description if present
    if (inputFormatIndex !== -1) {
      let inputOutputEnd = examplesIndex !== -1 ? examplesIndex :
                           constraintsIndex !== -1 ? constraintsIndex : fullText.length;

      const inputOutputSection = fullText.substring(inputFormatIndex, inputOutputEnd).trim();
      result.description += '\n\n' + inputOutputSection;
    }

    // Extract examples
    if (examplesIndex !== -1) {
      const examplesEnd = constraintsIndex !== -1 ? constraintsIndex : fullText.length;
      let examplesText = fullText.substring(examplesIndex, examplesEnd).trim();

      // Extract examples from DOM for better formatting
      result.examples = extractHackerRankExamples(contentElement, examplesText);
    }

    // Extract constraints
    if (constraintsIndex !== -1) {
      let constraintsText = fullText.substring(constraintsIndex).trim();
      result.constraints = constraintsText.replace(/^Constraints\s*[:\n]*/i, '').trim();
    }

    return result;
  }

  // Extract examples from HackerRank content
  function extractHackerRankExamples(contentElement, examplesText) {
    let examples = '';

    if (!contentElement) {
      return examples;
    }

    // Try to find Sample Input/Output blocks
    const sampleBlocks = contentElement.querySelectorAll('pre, code, .sample-input, .sample-output');

    if (sampleBlocks.length > 0) {
      sampleBlocks.forEach(block => {
        const text = block.textContent || block.innerText;
        if (text && text.trim().length > 3) {
          examples += text.trim() + '\n\n';
        }
      });
    }

    // Fallback to text extraction
    if (!examples || examples.length < 10) {
      examples = examplesText;
    }

    // Clean up examples
    examples = examples
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return examples;
  }

  function detectCodeSignal() {
    try {
      const title = document.querySelector('[class*="title"] h1, h1')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('[class*="description"], [class*="instruction"]');
      const parsedContent = parseGenericContent(descElement);

      // CodeSignal typically uses Monaco editor
      const codeEditor = document.querySelector('.monaco-editor textarea') ||
                        document.querySelector('input[type="hidden"][value*="function"]');
      let starterCode = codeEditor?.value || '';

      return {
        platform: 'CodeSignal',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: starterCode,
        language: detectLanguageFromCode(starterCode) || 'javascript',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting CodeSignal problem:', error);
      return null;
    }
  }

  function detectCodeforces() {
    try {
      const title = document.querySelector('.problem-statement .header .title')?.textContent?.trim() ||
                   document.querySelector('h1')?.textContent?.trim() || '';

      // Get problem statement for structured parsing
      const statementElement = document.querySelector('.problem-statement');
      const parsedContent = parseCodeforcesContent(statementElement);

      return {
        platform: 'Codeforces',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'cpp',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting Codeforces problem:', error);
      return null;
    }
  }

  // Parse Codeforces problem content
  function parseCodeforcesContent(contentElement) {
    const result = {
      description: '',
      examples: '',
      constraints: ''
    };

    if (!contentElement) {
      return result;
    }

    const fullText = contentElement.innerText || '';

    // Codeforces structure:
    // Statement (includes description) -> Input Specification -> Output Specification -> Examples -> (optional) Note

    // Find Input Specification
    const inputIndex = fullText.search(/\n\s*Input\s*\n/i);
    // Find Output Specification
    const outputIndex = fullText.search(/\n\s*Output\s*\n/i);
    // Find Examples
    const examplesIndex = fullText.search(/\n\s*(?:Sample Input|Examples?)\s*\n/i);
    // Find Note
    const noteIndex = fullText.search(/\n\s*Note\s*\n/i);

    // Extract description (everything before Input)
    let descEnd = inputIndex !== -1 ? inputIndex :
                  outputIndex !== -1 ? outputIndex :
                  examplesIndex !== -1 ? examplesIndex :
                  noteIndex !== -1 ? noteIndex : fullText.length / 2;

    result.description = fullText.substring(0, descEnd).trim();

    // Extract Input/Output specs (include as part of constraints for clarity)
    if (inputIndex !== -1 && outputIndex !== -1) {
      const inputSection = fullText.substring(inputIndex, outputIndex).trim();
      let specsEnd = examplesIndex !== -1 ? examplesIndex :
                     noteIndex !== -1 ? noteIndex : fullText.length;
      const outputSection = fullText.substring(outputIndex, specsEnd).trim();

      result.constraints = 'Input:\n' + inputSection.replace(/^Input\s*\n/i, '') +
                          '\n\nOutput:\n' + outputSection.replace(/^Output\s*\n/i, '');
    }

    // Extract examples
    if (examplesIndex !== -1) {
      const examplesEnd = noteIndex !== -1 ? noteIndex : fullText.length;
      const examplesText = fullText.substring(examplesIndex, examplesEnd).trim();
      result.examples = examplesText;
    }

    return result;
  }

  // Generic content parser for other platforms
  function parseGenericContent(contentElement) {
    const result = {
      description: '',
      examples: '',
      constraints: ''
    };

    if (!contentElement) {
      return result;
    }

    const fullText = contentElement.innerText || '';

    // Try to find common section headers
    const examplesPatterns = [
      /\n\s*Examples?\s*[:\n]/i,
      /\n\s*Sample\s+(?:Input|Output)\s*[:\n]/i,
      /\n\s*Example\s*\d+[:\n]/i
    ];

    let examplesIndex = -1;
    for (const pattern of examplesPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        examplesIndex = match.index;
        break;
      }
    }

    const constraintsPatterns = [
      /\n\s*Constraints?\s*[:\n]/i,
      /\n\s*(?:Limits?|Bounds?)\s*[:\n]/i,
      /\n\s*Notes?\s*[:\n]/i
    ];

    let constraintsIndex = -1;
    for (const pattern of constraintsPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        constraintsIndex = match.index;
        break;
      }
    }

    // Extract description
    let descEnd = examplesIndex !== -1 ? examplesIndex :
                  constraintsIndex !== -1 ? constraintsIndex : fullText.length;
    result.description = fullText.substring(0, descEnd).trim();

    // Extract examples
    if (examplesIndex !== -1) {
      const examplesEnd = constraintsIndex !== -1 ? constraintsIndex : fullText.length;
      result.examples = fullText.substring(examplesIndex, examplesEnd).trim();
    }

    // Extract constraints
    if (constraintsIndex !== -1) {
      result.constraints = fullText.substring(constraintsIndex).trim();
    }

    return result;
  }

  function detectCodewars() {
    try {
      const title = document.querySelector('.h2 span, h4')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('.markdown');
      const parsedContent = parseGenericContent(descElement);

      // Get initial code from editor
      const codeEditor = document.querySelector('textarea[class*="editor"], .CodeMirror textarea');
      let starterCode = codeEditor?.value || '';

      // Get difficulty (kyu)
      const difficultyEl = document.querySelector('.h2, .difficulty');
      const difficulty = difficultyEl?.textContent?.match(/\d+ kyu/i)?.[0] || '';

      return {
        platform: 'Codewars',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: starterCode,
        language: detectLanguageFromCode(starterCode) || 'javascript',
        difficulty: difficulty,
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting Codewars problem:', error);
      return null;
    }
  }

  function detectInterviewBit() {
    try {
      const title = document.querySelector('.p-title, h1')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('.problem-content, p');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'InterviewBit',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting InterviewBit problem:', error);
      return null;
    }
  }

  function detectHackerEarth() {
    try {
      const title = document.querySelector('.problem-title h1, h1')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('.problem-statement, .content');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'HackerEarth',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting HackerEarth problem:', error);
      return null;
    }
  }

  function detectAlgoExpert() {
    try {
      const title = document.querySelector('h1, [class*="title"]')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('[class*="description"], [class*="prompt"]');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'AlgoExpert',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting AlgoExpert problem:', error);
      return null;
    }
  }

  function detectBinarySearch() {
    try {
      const title = document.querySelector('h1, [class*="title"]')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('[class*="problem"], [class*="description"]');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'BinarySearch',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting BinarySearch problem:', error);
      return null;
    }
  }

  function detectCSES() {
    try {
      const title = document.querySelector('h1')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('.content');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'CSES',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'cpp',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting CSES problem:', error);
      return null;
    }
  }

  function detectAtCoder() {
    try {
      const title = document.querySelector('h2, h1')?.textContent?.trim() || '';

      // Get description element for structured parsing
      const descElement = document.querySelector('.lang-en, .part');
      const parsedContent = parseGenericContent(descElement);

      return {
        platform: 'AtCoder',
        title: title,
        description: parsedContent.description,
        constraints: parsedContent.constraints,
        examples: parsedContent.examples,
        starterCode: '',
        language: 'python',
        url: window.location.href
      };
    } catch (error) {
      console.error('[CodeSolver Pro] Error detecting AtCoder problem:', error);
      return null;
    }
  }

  function detectGenericCodingPage() {
    // Generic detection for unknown platforms
    // Look for common patterns
    try {
      const keywords = ['function', 'class', 'def ', 'return', 'input', 'output', 'algorithm'];
      const pageContent = document.body.innerText.toLowerCase();
      const keywordCount = keywords.filter(k => pageContent.includes(k)).length;

      // Check for code elements
      const codeBlocks = document.querySelectorAll('pre, code, .code, .editor, textarea');
      const hasCodeEditor = codeBlocks.length > 0;

      // Check for common interview problem indicators
      const hasConstraints = pageContent.includes('constraint') || pageContent.includes('limit');
      const hasExamples = pageContent.includes('example') || pageContent.includes('sample');
      const hasInputOutput = pageContent.includes('input') && pageContent.includes('output');

      if (keywordCount >= 3 && (hasCodeEditor || hasConstraints || hasExamples || hasInputOutput)) {
        const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() ||
                     document.title.split('|')[0].trim();

        // Find the main content area for structured parsing
        const contentSelectors = [
          'article',
          '[class*="description"]',
          '[class*="problem"]',
          '[class*="statement"]',
          'main',
          '.content'
        ];

        let contentElement = null;
        for (const selector of contentSelectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.length > 100) {
            contentElement = el;
            break;
          }
        }

        const parsedContent = parseGenericContent(contentElement);

        let starterCode = '';
        for (const block of codeBlocks) {
          const text = block.textContent || block.value;
          if (text && text.length > 20 && (text.includes('function') || text.includes('def ') || text.includes('class'))) {
            starterCode = text;
            break;
          }
        }

        return {
          platform: 'Generic',
          title: title,
          description: parsedContent.description,
          constraints: parsedContent.constraints,
          examples: parsedContent.examples,
          starterCode: starterCode,
          language: detectLanguageFromCode(starterCode) || 'python',
          url: window.location.href
        };
      }
    } catch (error) {
      console.error('[CodeSolver Pro] Error in generic detection:', error);
    }
    return null;
  }

  // ========== Helper functions ==========

  function detectLanguageFromCode(code) {
    if (!code) return 'python';

    const patterns = {
      javascript: [/function\s*\w+\s*\(/, /const\s+\w+\s*=/, /let\s+\w+\s*=/, /=>\s*{/],
      typescript: [/function\s*\w+\s*\(/, /:\s*(string|number|boolean)/],
      python: [/def\s+\w+\s*\(/, /class\s+\w+:/, /import\s+\w+/, /print\(/],
      java: [/public\s+(static\s+)?class/, /public\s+static\s+void\s+main/, /System\.out/],
      cpp: [/#include/, /using\s+namespace\s+std/, /cout\s*<</, /int\s+main\s*\(/],
      c: [/#include/, /int\s+main\s*\(/, /printf\(/],
      csharp: [/using\s+System/, /namespace\s+\w+/, /Console\.Write/],
      go: [/package\s+main/, /func\s+\w+\s*\(/, /import\s*\(/],
      ruby: [/def\s+\w+/, /puts\s+/, /end\s*$/],
      php: [/function\s+\w+\s*\(/, /\$[a-zA-Z_]\w*\s*=/, /<\?php/],
      rust: [/fn\s+\w+/, /let\s+mut\s+/, /use\s+std::/],
      swift: [/func\s+\w+\s*\(/, /var\s+\w+\s*=/, /let\s+\w+\s*=/]
    };

    for (const [lang, langPatterns] of Object.entries(patterns)) {
      if (langPatterns.some(p => p.test(code))) {
        return lang;
      }
    }

    return 'python';
  }

  function sendProblemToBackground(problemData) {
    chrome.runtime.sendMessage({
      action: 'storeProblem',
      data: problemData
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[CodeSolver Pro] Error sending problem:', chrome.runtime.lastError);
      } else {
        console.log('[CodeSolver Pro] Problem stored successfully');
        // Notify side panel
        chrome.runtime.sendMessage({
          action: 'questionDetected',
          data: problemData
        });
      }
    });
  }

  function observePageChanges() {
    // For SPA navigation
    let lastUrl = window.location.href;
    let detectionTimeout = null;
    let isDetecting = false;

    // Retry detection function for dynamic content
    function retryDetection(maxRetries = 5, delay = 1000) {
      let retries = 0;

      function attempt() {
        if (retries >= maxRetries) {
          console.log('[CodeSolver Pro] Max retries reached');
          return;
        }

        const problemData = currentPlatform ? currentPlatform.detect() : detectGenericCodingPage();

        // Check if we got meaningful data
        if (problemData && problemData.title && problemData.title !== 'Unknown Problem') {
          console.log('[CodeSolver Pro] Problem detected successfully');
          sendProblemToBackground(problemData);
          return;
        }

        // Check if there's actual content on the page yet
        const hasContent = document.body.innerText.length > 500;
        if (!hasContent) {
          console.log('[CodeSolver Pro] Waiting for content...');
          retries++;
          setTimeout(attempt, delay);
          return;
        }

        retries++;
        setTimeout(attempt, delay);
      }

      attempt();
    }

    // MutationObserver for dynamic content changes
    const observer = new MutationObserver((mutations) => {
      const currentUrl = window.location.href;

      // Check for URL change
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[CodeSolver Pro] URL changed, re-detecting...');
        clearTimeout(detectionTimeout);
        detectionTimeout = setTimeout(() => {
          retryDetection(8, 800);
        }, 500);
      }

      // Also check for significant DOM changes (content loading)
      const significantChanges = mutations.filter(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
      if (significantChanges.length > 3 && !isDetecting) {
        isDetecting = true;
        clearTimeout(detectionTimeout);
        detectionTimeout = setTimeout(() => {
          if (currentPlatform) {
            const problemData = currentPlatform.detect();
            if (problemData && problemData.title && problemData.title !== 'Unknown Problem') {
              sendProblemToBackground(problemData);
            }
          }
          isDetecting = false;
        }, 1500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      console.log('[CodeSolver Pro] Popstate detected');
      clearTimeout(detectionTimeout);
      detectionTimeout = setTimeout(() => {
        retryDetection();
      }, 500);
    });

    // Listen for custom pushState/replaceState (some SPAs use these)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function() {
      originalPushState.apply(this, arguments);
      clearTimeout(detectionTimeout);
      detectionTimeout = setTimeout(() => {
        retryDetection();
      }, 500);
    };

    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      clearTimeout(detectionTimeout);
      detectionTimeout = setTimeout(() => {
        retryDetection();
      }, 500);
    };

    // Initial detection with retry for pages that load content dynamically
    setTimeout(() => {
      retryDetection(10, 1000);
    }, 500);
  }

  // Listen for manual detection requests and focus protection messages
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'detectCurrentPage') {
      console.log('[CodeSolver Pro] Manual detection requested, current platform:', currentPlatform?.name || 'none');

      // Immediately respond with current detection state
      // Don't use async for the response - detect and respond immediately
      function detectNow() {
        const problemData = currentPlatform ? currentPlatform.detect() : detectGenericCodingPage();

        console.log('[CodeSolver Pro] Detection result:', {
          hasData: !!problemData,
          title: problemData?.title,
          description: problemData?.description ? problemData.description.substring(0, 50) + '...' : 'none'
        });

        sendResponse({ success: true, data: problemData });
      }

      // Wait for DOM to be ready, then detect
      if (document.readyState === 'loading') {
        console.log('[CodeSolver Pro] DOM still loading, waiting...');
        document.addEventListener('DOMContentLoaded', detectNow, { once: true });
      } else {
        // DOM is ready, detect immediately
        detectNow();
      }

      return true;
    }

    // Handle focus protection messages
    if (request.action === 'focusProtection') {
      console.log('[CodeSolver Pro] Focus protection message:', request.type);
      // Forward to injected script via window.postMessage
      window.postMessage({
        type: request.type,
        source: 'code-solver-extension'
      }, '*');
      sendResponse({ success: true });
      return true;
    }
  });

  // Prevent focus leak by intercepting blur events
  // This helps keep the page "active" even when side panel is open
  const originalBlur = window.onblur;
  window.addEventListener('blur', (e) => {
    // Check if the new focus target is our side panel
    // If so, don't propagate the blur event
    setTimeout(() => {
      if (document.hasFocus()) {
        return; // We still have focus, don't do anything
      }
    }, 0);
  }, true);

})();
