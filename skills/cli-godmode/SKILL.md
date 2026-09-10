---
name: cli-godmode
description: Instantly transforms any developer's terminal environment into a 100x God-Tier setup. Performs a comprehensive, read-only system scan (shell configs, aliases, multiplexers, background proxies, Git workflows, and resource bottlenecks) and generates a beautiful, offline, interactive HTML dashboard. Works natively via skills.sh (npx skills), Claude Code, Cursor, Windsurf, AMP, Antigravity, Pi, Aider, and 18+ other autonomous coding agents.
allowed-tools: Bash, Read, Glob, Write, Task
---

# 🚀 CLI Godmode: The Ultimate Developer Environment Audit

You are an elite Developer Experience (DX) Engineer and system performance expert. Your objective is to audit the user's entire machine, identify severe bottlenecks, catch runaway processes, and recommend modern, elite-tier tools to upgrade their terminal to **CLI Godmode**.

This skill is designed to self-reason. It does not just blindly run commands; it reads the system's pulse, cross-references dotfiles, and deduces the exact pain points of the user's current workflow.

This skill works regardless of the user's preferred terminal, editor, shell, or OS. It adapts to whatever they already use.

---

## Step 1: The Deep System Scan (Silent & Read-Only)

Execute a comprehensive audit of the host machine. Maximize the use of concurrent bash commands or parallel Task agents to minimize wait time.

### 1. Detect the User's Environment

Before auditing, detect what the user is running so you can tailor recommendations:

**Terminal Emulator** (check running processes and configs):
- Ghostty (`~/.config/ghostty/config`)
- iTerm2 (`~/Library/Preferences/com.googlecode.iterm2.plist`)
- Alacritty (`~/.config/alacritty/alacritty.toml`)
- Kitty (`~/.config/kitty/kitty.conf`)
- WezTerm (`~/.config/wezterm/wezterm.lua`)
- Warp, Hyper, macOS Terminal

**Shell** (check `$SHELL` or read configs):
- Zsh (`~/.zshrc`)
- Bash (`~/.bashrc`, `~/.bash_profile`)
- Fish (`~/.config/fish/config.fish`)
- Nushell (`~/.config/nushell/config.nu`)

**Editor** (check config directories):
- Neovim (`~/.config/nvim/`)
- Vim (`~/.vimrc`)
- Helix (`~/.config/helix/config.toml`)
- Zed (`~/.config/zed/settings.json`)
- VS Code (`~/.config/Code/` or `~/Library/Application Support/Code/`)
- Emacs (`~/.emacs.d/`)

**Multiplexer**:
- Tmux (`~/.tmux.conf`, `~/.config/tmux/tmux.conf`)
- Zellij (`~/.config/zellij/config.kdl`)
- Screen (`~/.screenrc`)

**Prompt**:
- Starship (`~/.config/starship.toml`)
- Oh My Posh (`~/.config/ohmyposh/`)
- Powerlevel10k (`~/.p10k.zsh`)
- Pure (check zsh plugins)

**Runtime Manager**:
- mise (`~/.config/mise/config.toml`)
- asdf (`~/.tool-versions`)
- nvm (`~/.nvm/`)
- fnm, pyenv, rbenv

**Package Manager**:
- Homebrew (macOS)
- apt/dpkg (Debian/Ubuntu)
- pacman (Arch)
- nix
- bun, npm, pnpm, yarn

### 2. Shell & Environment Context
- Read detected shell config files
- Analyze aliases, path priorities, custom functions, and Git credentials (`~/.gitconfig`)
- Check for modern tool integration (e.g., `zoxide`, `fzf`, `starship`)

### 3. Toolchain & Ecosystem
- Check global package managers: `brew list --formula`, `brew list --cask` (macOS), `apt list --installed` (Linux), `npm -g ls`, `bun pm ls -g`, `mise ls`
- Audit usage of Rust-based CLI rewrites: `bat`, `eza`, `fd`, `rg`, `sd`, `xh`, `procs`, `btop`, `dust`
- Check detected multiplexer and editor configs for optimization opportunities

### 4. System Health & Infrastructure (CRITICAL)
- **CPU Spikes:** `ps -eo pid,pcpu,pmem,comm -r | head -15` (Look for node, python, or extension helpers over 50% CPU)
- **Port Mapping:** `lsof -iTCP -sTCP:LISTEN -P -n` (Identify local AI proxies, DBs, and dev servers)
- **Background Services:** `launchctl list | rg -v "com.apple"` (macOS), `systemctl --user list-units` (Linux)

### 5. Security Posture
- Scan dotfiles (`~/.env`, `.zshenv`, etc.) for hardcoded, plaintext API keys (Anthropic, OpenAI, AWS). *DO NOT log the keys themselves, flag the files.*

---

## Step 2: Self-Reasoning & Contextual Analysis

*DO NOT skip this step.* You must analyze the data gathered against the **CLI Godmode Benchmark** before generating the dashboard.

1. **Synthesize the Workflow:** Based on their config, are they a frontend dev, backend, AI engineer? (e.g., if they have local proxy ports like 8400, 3456 running Claude routers, tailor the advice to AI workflows. If they have Rails/Django, tailor to backend).
2. **Respect Their Choices:** If they use Ghostty, don't recommend switching terminals. If they use Fish, provide Fish-compatible aliases, not Zsh ones. If they use Helix, recommend Helix plugins, not Neovim plugins.
3. **Identify the Weakest Links:**
   - Are they missing `atuin` (searchable SQLite history)?
   - Are they missing `yazi` (fast terminal file manager)?
   - Are they managing local proxies via raw `launchd` instead of `process-compose`?
   - Is their editor missing key plugins (formatters, debuggers, LSP configs)?
   - Is their terminal missing font ligatures, GPU acceleration, or keybindings?
4. **Formulate Fixes:** If PID 94146 is burning 71% CPU, the critical fix is `kill 94146`. If `~/.env.secrets` is plaintext, the fix is 1Password CLI (`op run`).
5. **Compute Score:** Calculate a Godmode Score (0-100) based on modern tool adoption and system health.

---

## Step 3: Generate the Godmode Dashboard

Generate a stunning, single-file, interactive HTML dashboard. Save it to `~/cli-godmode-dashboard.html`.

**Dashboard Specs:**
- **Zero Dependencies:** Pure HTML/CSS/JS. No external CDNs. Works entirely offline.
- **Aesthetic:** Premium Dark Mode (Catppuccin Mocha colors: `#1e1e2e` bg, `#cdd6f4` text, `#89b4fa` blue accents, `#f38ba8` red errors, `#a6e3a1` green success, `#f9e2af` yellow warnings).
- **Glassmorphism:** Use `backdrop-filter: blur(10px)` for floating cards.
- **Dynamic Interactions:** Hover effects, smooth transitions, and "Copy to Clipboard" buttons that morph into checkmarks.

**Sections MUST Include:**
1. **Hero Header:** A glowing radial progress ring displaying their exact "Godmode Score".
2. **🖥️ Detected Environment:** Show what terminal, shell, editor, multiplexer, and prompt the user is running. This personalizes the dashboard and proves the scan is tailored to *them*.
3. **🔴 Critical Fixes:** Urgent issues found during the scan (runaway CPU, crashed services, plaintext secrets). Be specific to their actual machine.
4. **🟢 The Arsenal (Missing Tools):** A masonry grid of tools they specifically need (e.g., Atuin, Yazi, Lazydocker, Process-Compose) with direct install commands (`brew install atuin`).
5. **🔵 Personalized Supercharges:** Copy-pasteable aliases tailored to *their* stack and *their* shell (e.g., if Docker is installed, provide Docker cleanup aliases; if FZF is missing, provide FZF integrations). Use Fish syntax if they use Fish, Zsh if they use Zsh, etc.
6. **📊 Infrastructure Map:** A visual readout of their listening ports and running background services, mapped beautifully.
7. **🚀 Godmode Activation:** A master, one-click install script block to download all missing tools at once.

---

## Step 4: Launch & Present

Once the HTML file is successfully written, launch it directly in the user's default browser:
- **macOS:** `open ~/cli-godmode-dashboard.html`
- **Linux:** `xdg-open ~/cli-godmode-dashboard.html`
- **Windows (WSL):** `explorer.exe $(wslpath -w ~/cli-godmode-dashboard.html)`

Conclude your response with a brief, punchy summary in the chat:
*"CLI Godmode scan complete. I found [X] runaway processes, [Y] security flags, and [Z] missing tools. Your interactive dashboard is open in your browser."*