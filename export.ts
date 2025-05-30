import fs from 'fs';

export interface M3UItem {
  title: string;
  logo: string;
  group: string;
  streamUrl: string;
  description?: string;
}

export function exportToM3U(filename: string, items: M3UItem[]) {
  let content = '#EXTM3U\n\n';

  // Group items by their group property for better organization
  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = [];
    }
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, M3UItem[]>);

  // Sort groups so "Trending Movies" comes first, then alphabetically
  const sortedGroups = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Trending Movies') return -1;
    if (b === 'Trending Movies') return 1;
    return a.localeCompare(b);
  });

  // Write items group by group
  for (const groupName of sortedGroups) {
    const groupItems = groupedItems[groupName];
    
    // Add a comment to separate groups
    content += `# ${groupName} (${groupItems.length} items)\n`;
    
    for (const item of groupItems) {
      const titleLine = `#EXTINF:-1 tvg-logo="${item.logo}" group-title="${item.group}", ${item.title}${item.description ? ` - ${item.description}` : ''}`;
      content += `${titleLine}\n${item.streamUrl}\n\n`;
    }
    
    content += '\n'; // Extra spacing between groups
  }

  fs.writeFileSync(filename, content.trim(), 'utf-8');
  console.log(`✅ M3U exported to ${filename}`);
  
  // Log summary
  console.log('📋 Export Summary:');
  for (const groupName of sortedGroups) {
    console.log(`   ${groupName}: ${groupedItems[groupName].length} items`);
  }
}