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

  for (const item of items) {
    const titleLine = `#EXTINF:-1 tvg-logo="${item.logo}" group-title="${item.group}", ${item.title}${item.description ? ` - ${item.description}` : ''}`;
    content += `${titleLine}\n${item.streamUrl}\n\n`;
  }

  fs.writeFileSync(filename, content.trim(), 'utf-8');
  console.log(`✅ M3U exported to ${filename}`);
}
