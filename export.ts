import fs from 'fs';
import path from 'path';

export interface M3UItem {
  title: string;
  logo: string;
  group: string;
  streamUrl: string;
  description?: string;
}

interface GroupSummary {
  [groupName: string]: number;
}

/**
 * Exports M3U items to an M3U playlist file
 * @param filename - The output filename
 * @param items - Array of M3U items to export
 */
export function exportToM3U(filename: string, items: M3UItem[]): void {
  try {
    validateInput(filename, items);
    
    const content = generateM3UContent(items);
    const summary = generateSummary(items);
    
    writeFile(filename, content);
    logExportResults(filename, summary);
    
  } catch (error) {
    console.error(`Failed to export M3U file: ${error}`);
    throw error;
  }
}

/**
 * Validates input parameters
 */
function validateInput(filename: string, items: M3UItem[]): void {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename provided');
  }
  
  if (!Array.isArray(items)) {
    throw new Error('Items must be an array');
  }
  
  if (items.length === 0) {
    console.warn('No items to export');
  }
}

/**
 * Generates the M3U file content
 */
function generateM3UContent(items: M3UItem[]): string {
  let content = '#EXTM3U\n\n';

  const groupedItems = groupItemsByCategory(items);
  const sortedGroups = getSortedGroupNames(groupedItems);

  for (const groupName of sortedGroups) {
    const groupItems = groupedItems[groupName];
    content += generateGroupSection(groupName, groupItems);
  }

  return content.trim();
}

/**
 * Groups items by their category/group
 */
function groupItemsByCategory(items: M3UItem[]): Record<string, M3UItem[]> {
  return items.reduce((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = [];
    }
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, M3UItem[]>);
}

/**
 * Returns group names sorted with "Trending Movies" first
 */
function getSortedGroupNames(groupedItems: Record<string, M3UItem[]>): string[] {
  return Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Trending Movies') return -1;
    if (b === 'Trending Movies') return 1;
    return a.localeCompare(b);
  });
}

/**
 * Generates content for a single group section
 */
function generateGroupSection(groupName: string, items: M3UItem[]): string {
  let section = `# ${groupName} (${items.length} items)\n`;

  for (const item of items) {
    const titleLine = generateExtinfLine(item);
    section += `${titleLine}\n${item.streamUrl}\n\n`;
  }
  
  return section + '\n';
}

/**
 * Generates the EXTINF line for an item
 */
function generateExtinfLine(item: M3UItem): string {
  const title = item.title || 'Unknown Title';
  const logo = item.logo ? `tvg-logo="${item.logo}" ` : '';
  const group = item.group ? `group-title="${item.group}"` : '';
  const description = item.description ? ` - ${item.description}` : '';
  
  return `#EXTINF:-1 ${logo}${group}, ${title}${description}`;
}

/**
 * Writes content to file with error handling
 */
function writeFile(filename: string, content: string): void {
  try {
    // Ensure directory exists
    const dir = path.dirname(filename);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filename, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write file ${filename}: ${error}`);
  }
}

/**
 * Generates summary statistics for the export
 */
function generateSummary(items: M3UItem[]): GroupSummary {
  return items.reduce((acc, item) => {
    acc[item.group] = (acc[item.group] || 0) + 1;
    return acc;
  }, {} as GroupSummary);
}

/**
 * Logs export results and summary
 */
function logExportResults(filename: string, summary: GroupSummary): void {
  console.log(`M3U exported successfully to: ${filename}`);
  console.log('Export Summary:');
  
  const sortedGroups = Object.keys(summary).sort((a, b) => {
    if (a === 'Trending Movies') return -1;
    if (b === 'Trending Movies') return 1;
    return a.localeCompare(b);
  });
  
  for (const groupName of sortedGroups) {
    console.log(`  ${groupName}: ${summary[groupName]} items`);
  }
}