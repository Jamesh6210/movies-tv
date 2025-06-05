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

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, M3UItem[]>);

  const sortedGroups = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Trending Movies') return -1;
    if (b === 'Trending Movies') return 1;
    return a.localeCompare(b);
  });

  for (const groupName of sortedGroups) {
    const groupItems = groupedItems[groupName];
    content += `# ${groupName} (${groupItems.length} items)\n`;

    for (const item of groupItems) {
      const titleLine = `#EXTINF:-1 tvg-logo="${item.logo}" group-title="${item.group}", ${item.title}${item.description ? ` - ${item.description}` : ''}`;
      content += `${titleLine}\n${item.streamUrl}\n\n`;
    }
    content += '\n';
  }

  fs.writeFileSync(filename, content.trim(), 'utf-8');
  console.log(`✅ M3U exported to ${filename}`);
  console.log('📋 Export Summary:');
  for (const groupName of sortedGroups) {
    console.log(`   ${groupName}: ${groupedItems[groupName].length} items`);
  }
}
