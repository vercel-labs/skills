import type { FeatureDeclaration } from './parser.ts';

interface Section {
  heading: string;
  level: number;
  content: string;
  featureName?: string;
}

/**
 * Filter skill markdown content to include only activated feature sections.
 * - Preamble (content before first feature-gated section) is always kept
 * - Sections matching activated features are kept
 * - Sections matching non-activated features are removed
 * - Non-feature sections (not matching any declared feature) are always kept
 * - The features frontmatter block is removed from output
 */
export function filterSkillContent(
  rawMarkdown: string,
  declaration: FeatureDeclaration,
  activated: string[]
): string {
  const activatedSet = new Set(activated);

  // Build a map from section heading to feature name
  const sectionToFeature = new Map<string, string>();
  for (const [name, info] of Object.entries(declaration.available)) {
    sectionToFeature.set(info.section.toLowerCase(), name);
  }

  // Parse content into sections
  const lines = rawMarkdown.split('\n');
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let preambleLines: string[] = [];
  let foundFirstHeading = false;

  // Skip frontmatter
  let inFrontmatter = false;
  let frontmatterDone = false;
  const contentLines: string[] = [];

  for (const line of lines) {
    if (!frontmatterDone) {
      if (line.trim() === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        } else {
          frontmatterDone = true;
          continue;
        }
      }
      if (inFrontmatter) continue;
    }
    contentLines.push(line);
  }

  for (const line of contentLines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const heading = headingMatch[2]!.trim();

      if (currentSection) {
        sections.push(currentSection);
      }

      foundFirstHeading = true;
      const featureName = sectionToFeature.get(heading.toLowerCase());
      currentSection = {
        heading,
        level,
        content: line + '\n',
        featureName,
      };
    } else if (!foundFirstHeading) {
      preambleLines.push(line);
    } else if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      preambleLines.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  // Build filtered output
  const outputParts: string[] = [];

  // Always include preamble
  const preamble = preambleLines.join('\n').trim();
  if (preamble) {
    outputParts.push(preamble);
  }

  // Filter sections
  for (const section of sections) {
    if (section.featureName) {
      // Feature-gated section: include only if activated
      if (activatedSet.has(section.featureName)) {
        outputParts.push(section.content.trimEnd());
      }
    } else {
      // Non-feature section: always include
      outputParts.push(section.content.trimEnd());
    }
  }

  return outputParts.join('\n\n') + '\n';
}
