#!/usr/bin/env node

/**
 * Unified Build Script for CodeSolver Pro
 * Creates release folders for both Chrome and Firefox with minified and obfuscated JavaScript files
 */

const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  sourceDir: path.join(__dirname, 'src'),
  chromeReleaseDir: path.join(__dirname, 'chrome_release'),
  firefoxReleaseDir: path.join(__dirname, 'firefox_release'),
  jsFiles: [
    'background.js',
    'content.js',
    'injected.js',
    'sidepanel.js'
  ],
  cssFiles: [
    'sidepanel.css'
  ],
  htmlFiles: [
    'sidepanel.html'
  ],
  copyDirs: [
    'icons'
  ],
  // Terser options for minification
  terserOptions: {
    compress: {
      dead_code: true,
      drop_console: false,
      drop_debugger: true,
      pure_funcs: [],
      passes: 3
    },
    mangle: {
      properties: false,
      keep_fnames: false,
      toplevel: true
    },
    format: {
      comments: false
    }
  },
  // JavaScript Obfuscator options
  obfuscatorOptions: {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
  }
};

// Platform-specific configurations
const PLATFORMS = {
  chrome: {
    name: 'Chrome',
    releaseDir: CONFIG.chromeReleaseDir,
    manifestFile: 'chrome.json',
    namespace: 'chrome',
    apiTransform: (code) => code, // No transformation needed for Chrome
    readmeTemplate: 'chrome'
  },
  firefox: {
    name: 'Firefox',
    releaseDir: CONFIG.firefoxReleaseDir,
    manifestFile: 'firefox.json',
    namespace: 'browser',
    apiTransform: (code) => {
      // Transform chrome.* APIs to browser.* for Firefox
      let transformed = code.replace(/chrome\./g, 'browser.');
      // Add polyfill at the beginning
      const polyfill = `
// Firefox compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}
`;
      return polyfill + transformed;
    },
    readmeTemplate: 'firefox'
  }
};

/**
 * Ensure directory exists, create if not
 */
async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Remove directory recursively
 */
async function removeDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore if directory doesn't exist
  }
}

/**
 * Copy a file to destination
 */
async function copyFile(src, dest) {
  await fs.copyFile(src, dest);
}

/**
 * Copy directory recursively
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Minify and obfuscate a JavaScript file for a specific platform
 */
async function processJsFile(filename, platform) {
  const { minify } = await import('terser');
  const obfuscatorModule = await import('javascript-obfuscator');

  // The module exports version and obfuscate function
  const JavaScriptObfuscator = obfuscatorModule.default || obfuscatorModule;

  const sourcePath = path.join(CONFIG.sourceDir, 'js', filename);
  const destPath = path.join(platform.releaseDir, filename);

  console.log(`  Processing: ${filename}`);

  // Read source file
  let sourceCode = await fs.readFile(sourcePath, 'utf8');

  // Apply platform-specific API transformations
  sourceCode = platform.apiTransform(sourceCode);

  // Step 1: Minify with Terser
  console.log(`    - Minifying...`);
  const minified = await minify(sourceCode, CONFIG.terserOptions);

  if (minified.error) {
    console.error(`    - Terser error: ${minified.error.message}`);
    throw minified.error;
  }

  // Step 2: Obfuscate with JavaScript Obfuscator
  console.log(`    - Obfuscating...`);
  const obfuscationResult = JavaScriptObfuscator.obfuscate(
    minified.code,
    CONFIG.obfuscatorOptions
  );

  // Write obfuscated code
  await fs.writeFile(destPath, obfuscationResult.getObfuscatedCode(), 'utf8');
  console.log(`    ✓ Done (${obfuscationResult.getObfuscatedCode().length} bytes)`);
}

/**
 * Generate release-specific README.md
 */
async function generateReleaseReadme(platform) {
  const packageJsonPath = path.join(__dirname, 'package.json');
  let version = '1.0.0';

  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    version = packageJson.version || '1.0.0';
  } catch (err) {
    // Use default version if package.json not found
  }

  const isChrome = platform.name === 'Chrome';
  const browserName = isChrome ? 'Chrome' : 'Firefox';
  const addOnType = isChrome ? 'Extension' : 'Add-on';
  const installInstructions = isChrome ? chromeInstallInstructions : firefoxInstallInstructions;
  const debugUrl = isChrome ? 'chrome://extensions/' : 'about:debugging#/runtime/this-firefox';
  const manifestVersion = isChrome ? 'V3' : 'V2';
  const apiName = isChrome ? 'chrome.*' : 'browser.*';
  const panelType = isChrome ? 'Side Panel' : 'Sidebar';
  const iconUrl = isChrome
    ? 'https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome'
    : 'https://img.shields.io/badge/Firefox-Add-on-orange?logo=firefox';

  const readmeContent = `# CodeSolver Pro - ${browserName} ${addOnType}

<div align="center">

**AI-Powered Coding Interview Assistant with Undetectable ${panelType}**

[![${browserName} ${addOnType}](${iconUrl})]
[![Manifest ${manifestVersion}](https://img.shields.io/badge/Manifest-${manifestVersion}-blue)]
[![Version](https://img.shields.io/badge/Version-${version}-orange)]

An intelligent ${browserName.toLowerCase()} extension that helps you solve coding interview problems by leveraging AI models while keeping your assistance undetectable through advanced focus protection techniques.

This extension can solve coding problems with undetectable focus protection. Supports 30+ platforms including LeetCode, HackerRank, and more.

Better than other extensions - Its free and private. Can integrate locally with ollama, llama.cpp server.

</div>

---

## ⚡ Quick Start

### Installation

1. **Download the Release**
   - Download and extract the ZIP file from the [Releases](../../releases) page

2. **Load in ${browserName}**
${installInstructions}

3. **Verify Installation**
   - Click the Extensions icon in ${browserName}'s toolbar
   - Find "CodeSolver Pro" and click it
   - The ${panelType.toLowerCase()} should open

### First Time Setup

1. **Open a Coding Problem**
   - Navigate to [LeetCode](https://leetcode.com), [HackerRank](https://hackerrank.com), or any supported platform
   - Open a problem page

2. **Configure AI Provider**
   - Click the **Settings** (gear icon) in the ${panelType.toLowerCase()}
   - Click **"Add Profile"**
   - Choose your AI provider:
     - **OpenAI**: Get API key from https://platform.openai.com/api-keys
     - **Anthropic**: Get API key from https://console.anthropic.com/
     - **Local LLM**: Use [Ollama](https://ollama.ai) (free, works offline)
   - Save your profile

3. **Solve Your First Problem**
   - Select your AI profile from the dropdown
   - Choose your programming language
   - Click **"Solve Problem"**
   - View the generated solution!

---

## ✨ Features

### 🎯 Smart Problem Detection
- Automatically detects coding problems from 30+ platforms
- Supports: LeetCode, HackerRank, CodeSignal, Codeforces, Codewars, and more
- Extracts problem description, examples, constraints, and starter code

### 🤖 AI-Powered Solutions
- **Multiple AI Providers**: OpenAI (GPT-4), Anthropic (Claude), Local LLMs
- **Comprehensive Output**:
  - Step-by-step approach
  - Time & space complexity analysis
  - Complete working code
  - Detailed explanation
- **Multi-Language Support**: Python, JavaScript, Java, C++, Go, Rust, and more

### 🔒 Undetectable Operation
- **Focus Protection**: Prevents blur event detection
- **Visibility Override**: Always appears "visible" to webpages
- **Active Element Preservation**: Maintains focus state
- **Multi-Layer Defense**: Works at multiple levels for maximum effectiveness

### 💾 Solution Management
- **Local Storage**: All solutions stored locally in your browser
- **Language-Specific**: Different solutions for same problem in different languages
- **XML Export**: Backup all your solutions
- **Persistent**: Solutions remain available across browser sessions

### 👤 Profile System
- **Multiple Profiles**: Switch between different AI configurations
- **Import/Export**: Backup and share your AI profiles
- **Background Processing**: Generate solutions for multiple problems simultaneously

---

## 🌐 Supported Platforms

| Platform | Status |
|----------|--------|
| LeetCode | ✅ Full Support |
| HackerRank | ✅ Full Support |
| CodeSignal | ✅ Full Support |
| Codeforces | ✅ Full Support |
| Codewars | ✅ Full Support |
| InterviewBit | ✅ Full Support |
| HackerEarth | ✅ Full Support |
| AlgoExpert | ✅ Full Support |
| BinarySearch | ✅ Full Support |
| CSES | ✅ Full Support |
| AtCoder | ✅ Full Support |
| CodeChef | ✅ Full Support |
| GeeksforGeeks | ✅ Full Support |
| And 15+ more... | ✅ Full Support |

**Generic Detection**: Works on custom coding platforms too!

---

## 📖 Usage Guide

### Solving a Problem

1. Navigate to any coding problem on a supported platform
2. The extension auto-detects the problem
3. Select your AI profile and language
4. Click **"Solve Problem"**
5. View the solution in the Solution tab

### Managing AI Profiles

**Create a Profile:**
- Settings → Add Profile
- Configure provider, API key, model, and parameters
- Save profile

**Switch Profiles:**
- Use the profile dropdown in the Solution tab

**Export/Import:**
- Settings → Export/Import Profiles
- Share profiles with team members

### Custom Whitelist

Add custom websites:
1. Open Settings
2. Scroll to Website Whitelist
3. Enter website URL (e.g., \`https://customplatform.com\`)
4. Click Add

---

## 🔧 Configuration

### AI Provider Setup

#### OpenAI
\`\`\`
Provider: openai
API Key: sk-... (from https://platform.openai.com/api-keys)
Model: gpt-4 or gpt-4-turbo
Temperature: 0.2 (recommended for coding)
\`\`\`

#### Anthropic Claude
\`\`\`
Provider: anthropic
API Key: sk-ant-... (from https://console.anthropic.com/)
Model: claude-3-5-sonnet-20241022
Temperature: 0.2
\`\`\`

#### Local LLM (Ollama)
\`\`\`
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.1

# Configure in extension
Provider: local
URL: http://localhost:11434/v1/chat/completions
Model: llama3.1
# No API key required!
\`\`\`

**Benefits of Local LLM:**
- ✅ Completely free
- ✅ Works offline
- ✅ Privacy-focused

---

## 🏗️ Technical Details

**API Used**: ${apiName}
**Manifest Version**: ${manifestVersion}
**Panel Type**: ${panelType}
**Minimum ${browserName} Version**: ${isChrome ? '114' : '115'}

---

## 🔒 Privacy & Security

- **Local Storage Only**: All data stored in ${isChrome ? '`chrome.storage.local`' : '`browser.storage.local`'}
- **No External Servers**: No data sent except to configured AI APIs
- **API Keys**: Stored securely, never shared
- **No Analytics**: No usage tracking or data collection
- **Solutions**: Never uploaded, stay on your device

---

## 📋 Requirements

- **${browserName} Browser**: Version ${isChrome ? '114' : '115'} or higher
- **AI Provider**: API key or local LLM setup

---

## 🐛 Troubleshooting

**Problem: "No problem detected"**
- Click "Refresh Detection" button
- Ensure you're on a problem page (not list view)
- Check if website is whitelisted

**Problem: AI not generating**
- Verify API key is correct
- Check API credits/quota
- Try a different profile
- Check Browser Console for errors (F12)

**Problem: Focus protection not working**
- Refresh the problem page
- Re-open the ${panelType.toLowerCase()}
- Check console for errors
- Note: Some platforms have advanced detection

**Debug URL**: \`${debugUrl}\`

---

## 📚 Documentation

For detailed documentation, development guide, and API reference, visit the [main repository](../../).

---

## ⚠️ Disclaimer

This extension is intended for **educational and practice purposes only**.

Using AI assistance during actual coding assessments, interviews, or competitions where external help is prohibited is unethical and may violate terms of service.

**Always use responsibly and ethically.**

---

## 📝 License

MIT License - See [LICENSE](../../LICENSE) in the main repository.

---

## 🤝 Contributing

Contributions are welcome! Please visit the [main repository](../../) to:
- Report bugs
- Request features
- Submit pull requests

---

<div align="center">

**Built with ❤️ for the developer community**

[GitHub](../../) • [Issues](../../issues) • [Releases](../../releases)

**Version ${version}** • Built on ${new Date().toISOString().split('T')[0]}

**${browserName} Edition**

</div>
`;

  const readmePath = path.join(platform.releaseDir, 'README.md');
  await fs.writeFile(readmePath, readmeContent, 'utf8');
  console.log(`  ✓ Generated README.md`);
}

/**
 * Build for a specific platform
 */
async function buildPlatform(platformKey) {
  const platform = PLATFORMS[platformKey];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Building for ${platform.name}`);
  console.log('='.repeat(60));

  // Clean release directory
  console.log('\nStep 1: Cleaning release directory...');
  await removeDir(platform.releaseDir);
  await ensureDir(platform.releaseDir);
  console.log('  ✓ Release directory cleaned');

  // Copy and transform manifest
  console.log('\nStep 2: Copying manifest.json...');
  const manifestSrc = path.join(CONFIG.sourceDir, 'manifests', platform.manifestFile);
  const manifestDest = path.join(platform.releaseDir, 'manifest.json');
  await copyFile(manifestSrc, manifestDest);
  console.log(`  ✓ Copied ${platform.manifestFile}`);

  // Process JavaScript files
  console.log('\nStep 3: Processing JavaScript files...');
  console.log('-'.repeat(60));
  for (const jsFile of CONFIG.jsFiles) {
    await processJsFile(jsFile, platform);
  }

  // Copy CSS files
  console.log('\nStep 4: Copying CSS files...');
  for (const cssFile of CONFIG.cssFiles) {
    const srcPath = path.join(CONFIG.sourceDir, 'css', cssFile);
    const destPath = path.join(platform.releaseDir, cssFile);
    try {
      await copyFile(srcPath, destPath);
      console.log(`  ✓ Copied: ${cssFile}`);
    } catch (err) {
      console.log(`  - Skipped: ${cssFile} (not found)`);
    }
  }

  // Copy HTML files
  console.log('\nStep 5: Copying HTML files...');
  for (const htmlFile of CONFIG.htmlFiles) {
    const srcPath = path.join(CONFIG.sourceDir, 'html', htmlFile);
    const destPath = path.join(platform.releaseDir, htmlFile);
    try {
      await copyFile(srcPath, destPath);
      console.log(`  ✓ Copied: ${htmlFile}`);
    } catch (err) {
      console.log(`  - Skipped: ${htmlFile} (not found)`);
    }
  }

  // Copy directories
  console.log('\nStep 6: Copying directories...');
  for (const dir of CONFIG.copyDirs) {
    const srcPath = path.join(CONFIG.sourceDir, dir);
    const destPath = path.join(platform.releaseDir, dir);
    try {
      await copyDir(srcPath, destPath);
      console.log(`  ✓ Copied: ${dir}/`);
    } catch (err) {
      console.log(`  - Skipped: ${dir}/ (not found)`);
    }
  }

  // Generate README
  console.log('\nStep 7: Generating release README.md...');
  await generateReleaseReadme(platform);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${platform.name} build completed successfully!`);
  console.log(`Release folder: ${platform.releaseDir}`);
  console.log('='.repeat(60));
}

/**
 * Main build function
 */
async function build() {
  const startTime = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('CodeSolver Pro - Unified Build Script');
  console.log('='.repeat(60));
  console.log('\nBuilding releases for both Chrome and Firefox...\n');

  try {
    // Get build target from command line arguments
    const args = process.argv.slice(2);
    const target = args[0] ? args[0].toLowerCase() : 'all';

    if (target === 'chrome' || target === 'ch') {
      await buildPlatform('chrome');
    } else if (target === 'firefox' || target === 'ff') {
      await buildPlatform('firefox');
    } else if (target === 'all' || target === 'both') {
      await buildPlatform('chrome');
      await buildPlatform('firefox');
    } else {
      console.error(`\n❌ Unknown target: ${target}`);
      console.log('\nUsage: node build.js [chrome|firefox|all]');
      console.log('  chrome, ch  - Build Chrome extension only');
      console.log('  firefox, ff - Build Firefox extension only');
      console.log('  all, both   - Build both extensions (default)');
      process.exit(1);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    console.log(`✅ All builds completed successfully! (${duration}s)`);
    console.log('='.repeat(60));
    console.log('\n📦 Release folders:');
    console.log(`   Chrome:  ${CONFIG.chromeReleaseDir}`);
    console.log(`   Firefox: ${CONFIG.firefoxReleaseDir}`);
    console.log('\n💡 To load the extension:');
    console.log('   Chrome:  Open chrome://extensions/ → Load unpacked');
    console.log('   Firefox: Open about:debugging#/runtime/this-firefox → Load Temporary Add-on');
    console.log('\n📦 To create distribution packages:');
    console.log(`   Chrome:  cd ${CONFIG.chromeReleaseDir} && zip -r ../CodeSolver_Pro_Chrome.zip *`);
    console.log(`   Firefox: cd ${CONFIG.firefoxReleaseDir} && zip -r ../CodeSolver_Pro_Firefox.xpi *`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Install instructions templates
const chromeInstallInstructions = `   \`\`\`bash
   # Open Chrome and navigate to:
   chrome://extensions/
   \`\`\`
   - Enable **Developer mode** (toggle in top-right)
   - Click **"Load unpacked"**
   - Select the extracted folder`;

const firefoxInstallInstructions = `   \`\`\`bash
   # Open Firefox and navigate to:
   about:debugging#/runtime/this-firefox
   \`\`\`
   - Click **"Load Temporary Add-on..."**
   - Select the \`manifest.json\` file from the extracted folder

   **OR** for permanent installation:
   - Open Firefox and go to \`about:addons\`
   - Click the gear icon → **"Install Add-on From File..."**
   - Select the extracted folder (create a .xpi package first)`;

// Run build
build();
