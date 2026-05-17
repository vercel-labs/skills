/**
 * Unit tests for terminal escape sanitization (CWE-150 fix).
 *
 * These tests verify that untrusted metadata from SKILL.md frontmatter
 * and remote APIs cannot inject terminal escape sequences that could:
 * - Clear the screen
 * - Move the cursor
 * - Change the terminal window title
 * - Render attacker-controlled text as if it were legitimate CLI output
 */

import { describe, it, expect } from 'vitest';
import { stripTerminalEscapes, sanitizeMetadata } from '../src/sanitize.ts';

describe('stripTerminalEscapes', () => {
  describe('CSI sequences (ESC[...)', () => {
    it('strips SGR color codes', () => {
      expect(stripTerminalEscapes('\x1b[31mred text\x1b[0m')).toBe('red text');
      expect(stripTerminalEscapes('\x1b[1;32mbold green\x1b[0m')).toBe('bold green');
      expect(stripTerminalEscapes('\x1b[38;5;145mextended color\x1b[0m')).toBe('extended color');
    });

    it('strips cursor movement sequences', () => {
      expect(stripTerminalEscapes('\x1b[H')).toBe(''); // cursor home
      expect(stripTerminalEscapes('\x1b[5;10H')).toBe(''); // cursor to row 5, col 10
      expect(stripTerminalEscapes('\x1b[A')).toBe(''); // cursor up
      expect(stripTerminalEscapes('\x1b[10B')).toBe(''); // cursor down 10
      expect(stripTerminalEscapes('\x1b[C')).toBe(''); // cursor forward
      expect(stripTerminalEscapes('\x1b[D')).toBe(''); // cursor back
    });

    it('strips screen clear sequences', () => {
      expect(stripTerminalEscapes('\x1b[2J')).toBe(''); // clear screen
      expect(stripTerminalEscapes('\x1b[3J')).toBe(''); // clear screen + scrollback
      expect(stripTerminalEscapes('\x1b[K')).toBe(''); // clear to end of line
      expect(stripTerminalEscapes('\x1b[2K')).toBe(''); // clear entire line
    });

    it('strips scroll sequences', () => {
      expect(stripTerminalEscapes('\x1b[S')).toBe(''); // scroll up
      expect(stripTerminalEscapes('\x1b[T')).toBe(''); // scroll down
    });
  });

  describe('OSC sequences (ESC]...BEL/ST)', () => {
    it('strips window title changes (OSC 0)', () => {
      expect(stripTerminalEscapes('\x1b]0;malicious title\x07')).toBe('');
      expect(stripTerminalEscapes('\x1b]0;[POC] hijacked\x07rest')).toBe('rest');
    });

    it('strips OSC with ST terminator (ESC\\)', () => {
      expect(stripTerminalEscapes('\x1b]0;title\x1b\\')).toBe('');
    });

    it('strips hyperlink sequences (OSC 8)', () => {
      expect(stripTerminalEscapes('\x1b]8;;https://evil.com\x07click\x1b]8;;\x07')).toBe('click');
    });
  });

  describe('simple escape sequences', () => {
    it('strips save/restore cursor', () => {
      expect(stripTerminalEscapes('\x1b7text\x1b8')).toBe('text');
    });

    it('strips other two-byte escapes', () => {
      expect(stripTerminalEscapes('\x1bM')).toBe(''); // reverse index
      expect(stripTerminalEscapes('\x1bc')).toBe(''); // reset terminal
    });
  });

  describe('control characters', () => {
    it('strips BEL character', () => {
      expect(stripTerminalEscapes('hello\x07world')).toBe('helloworld');
    });

    it('strips backspace', () => {
      expect(stripTerminalEscapes('hello\x08world')).toBe('helloworld');
    });

    it('strips carriage return', () => {
      expect(stripTerminalEscapes('hello\rworld')).toBe('helloworld');
    });

    it('preserves tabs and newlines', () => {
      expect(stripTerminalEscapes('hello\tworld')).toBe('hello\tworld');
      expect(stripTerminalEscapes('hello\nworld')).toBe('hello\nworld');
    });

    it('strips null bytes', () => {
      expect(stripTerminalEscapes('hello\x00world')).toBe('helloworld');
    });
  });

  describe('C1 control codes (8-bit)', () => {
    it('strips C1 control codes', () => {
      expect(stripTerminalEscapes('hello\x9bworld')).toBe('helloworld');
      expect(stripTerminalEscapes('hello\x9dworld')).toBe('helloworld');
    });
  });

  describe('preserves normal text', () => {
    it('leaves plain ASCII text unchanged', () => {
      expect(stripTerminalEscapes('hello world')).toBe('hello world');
    });

    it('leaves unicode text unchanged', () => {
      expect(stripTerminalEscapes('hello 日本語 world')).toBe('hello 日本語 world');
    });

    it('leaves emoji unchanged', () => {
      expect(stripTerminalEscapes('hello 🎉 world')).toBe('hello 🎉 world');
    });
  });

  describe('real-world attack payloads', () => {
    it('strips the POC payload from the bug report', () => {
      const malicious =
        '\x1b]0;[POC] skills output hijacked\x07\x1b[3J\x1b[2J\x1b[H\x1b[31m[POC] Terminal output injected from SKILL.md\x1b[0m\n\x1b[33mThis cleared the screen and overwrote CLI output.\x1b[0m';
      const result = stripTerminalEscapes(malicious);
      expect(result).not.toContain('\x1b');
      expect(result).not.toContain('\x07');
      expect(result).toContain('[POC] Terminal output injected from SKILL.md');
      expect(result).toContain('This cleared the screen and overwrote CLI output.');
    });

    it('strips concealed text attack', () => {
      const malicious = 'safe-skill\x1b[8m(downloads malware)\x1b[0m';
      const result = stripTerminalEscapes(malicious);
      expect(result).toBe('safe-skill(downloads malware)');
    });

    it('strips screen clear + fake output', () => {
      const malicious = 'safe-skill\x1b[2J\x1b[H\x1b[32m✓ Verified Safe\x1b[0m';
      const result = stripTerminalEscapes(malicious);
      expect(result).toBe('safe-skill✓ Verified Safe');
    });

    it('strips combined title change + clear + cursor move + colored text', () => {
      const malicious =
        '\x1b]0;pwned\x07' + // change title
        '\x1b[3J' + // clear scrollback
        '\x1b[2J' + // clear screen
        '\x1b[H' + // cursor home
        '\x1b[32mFake output\x1b[0m'; // green text
      const result = stripTerminalEscapes(malicious);
      expect(result).toBe('Fake output');
      expect(result).not.toContain('\x1b');
    });
  });
});

describe('sanitizeMetadata', () => {
  it('strips escape sequences and trims', () => {
    expect(sanitizeMetadata('  \x1b[31mhello\x1b[0m  ')).toBe('hello');
  });

  it('collapses newlines into spaces', () => {
    expect(sanitizeMetadata('line1\nline2\nline3')).toBe('line1 line2 line3');
  });

  it('collapses carriage returns into spaces', () => {
    // CR is stripped as control char, then newline collapsed
    expect(sanitizeMetadata('line1\r\nline2')).toBe('line1 line2');
  });

  it('handles the full POC payload', () => {
    const malicious =
      '\u001b]0;[POC] skills output hijacked\u0007\u001b[3J\u001b[2J\u001b[H\u001b[31m[POC] Terminal output injected from SKILL.md\u001b[0m\n\u001b[33mThis cleared the screen and overwrote CLI output.\u001b[0m';
    const result = sanitizeMetadata(malicious);
    expect(result).not.toContain('\x1b');
    expect(result).not.toContain('\x07');
    // Newline is collapsed to space
    expect(result).toBe(
      '[POC] Terminal output injected from SKILL.md This cleared the screen and overwrote CLI output.'
    );
  });

  it('handles normal skill names unchanged', () => {
    expect(sanitizeMetadata('next-best-practices')).toBe('next-best-practices');
    expect(sanitizeMetadata('AI SDK')).toBe('AI SDK');
    expect(sanitizeMetadata('Creating Diagrams')).toBe('Creating Diagrams');
  });

  it('handles normal descriptions unchanged', () => {
    expect(sanitizeMetadata('Build UIs with @nuxt/ui v4')).toBe('Build UIs with @nuxt/ui v4');
    expect(sanitizeMetadata('Guide for implementing smooth, native-feeling animations')).toBe(
      'Guide for implementing smooth, native-feeling animations'
    );
  });
});
