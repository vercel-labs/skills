import pc from 'picocolors';

/**
 * Represents a hidden HTML comment found in skill content.
 */
export interface HiddenComment {
  skillName: string;
  line: number;
  content: string;
}

/**
 * Regex to match HTML comments, including multi-line ones.
 * Captures the comment content between <!-- and -->.
 */
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;

/**
 * Check a single skill's raw SKILL.md content for HTML comments.
 * Returns an array of hidden comments found.
 */
export function checkForHtmlComments(
  skillName: string,
  rawContent: string | undefined
): HiddenComment[] {
  if (!rawContent) return [];

  const comments: HiddenComment[] = [];
  const lines = rawContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Check for single-line comments
    HTML_COMMENT_RE.lastIndex = 0;
    let match;
    while ((match = HTML_COMMENT_RE.exec(line)) !== null) {
      comments.push({
        skillName,
        line: i + 1,
        content: match[1]!.trim(),
      });
    }
  }

  // Also check for multi-line comments spanning multiple lines
  HTML_COMMENT_RE.lastIndex = 0;
  let multiMatch;
  while ((multiMatch = HTML_COMMENT_RE.exec(rawContent)) !== null) {
    const commentContent = multiMatch[1]!.trim();
    // Only add if it wasn't already found as a single-line comment
    const alreadyFound = comments.some((c) => c.content === commentContent);
    if (!alreadyFound) {
      // Find the line number of the opening <!--
      const beforeComment = rawContent.substring(0, multiMatch.index);
      const line = beforeComment.split('\n').length;
      comments.push({
        skillName,
        line,
        content: commentContent,
      });
    }
  }

  return comments;
}

/**
 * Check multiple skills for HTML comments and return formatted warning lines.
 */
export function buildHtmlCommentWarning(
  skills: Array<{ name: string; rawContent?: string }>
): string[] {
  const allComments: HiddenComment[] = [];

  for (const skill of skills) {
    const comments = checkForHtmlComments(skill.name, skill.rawContent);
    allComments.push(...comments);
  }

  if (allComments.length === 0) return [];

  const lines: string[] = [
    pc.yellow(
      pc.bold(
        `⚠️  Found ${allComments.length} hidden HTML comment${allComments.length > 1 ? 's' : ''}`
      )
    ),
    pc.dim('HTML comments are invisible in rendered markdown but can contain'),
    pc.dim('hidden instructions that may manipulate AI agent behavior.'),
    '',
  ];

  for (const comment of allComments) {
    const preview =
      comment.content.length > 100 ? comment.content.substring(0, 100) + '...' : comment.content;
    lines.push(
      `  ${pc.yellow('•')} ${pc.cyan(comment.skillName)} ${pc.dim(`(line ${comment.line})`)}`
    );
    lines.push(`    ${pc.dim('<!-- ')}${pc.yellow(preview)}${pc.dim(' -->')}`);
  }

  return lines;
}
