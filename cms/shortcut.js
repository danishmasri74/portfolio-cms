// Creates "Portfolio CMS" on the Windows desktop. Run: npm run cms:shortcut
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localDir = join(root, 'cms', '.local');
mkdirSync(localDir, { recursive: true });

// Build an .ico from the site's favicon (ICO files may contain PNG images).
const svg = readFileSync(join(root, 'site', 'public', 'favicon.svg'));
const sizes = [16, 32, 48, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  const s = sizes[i] >= 256 ? 0 : sizes[i];
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
const icon = join(localDir, 'portfolio-cms.ico');
writeFileSync(icon, Buffer.concat([header, ...entries, ...pngs]));

const launcher = join(root, 'cms', 'launch.vbs');
const ps = `
$desk = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Portfolio CMS.lnk'))
$s.TargetPath = "$env:WINDIR\\System32\\wscript.exe"
$s.Arguments = '"${launcher.replace(/'/g, "''")}"'
$s.WorkingDirectory = '${root.replace(/'/g, "''")}'
$s.IconLocation = '${icon.replace(/'/g, "''")}'
$s.Description = 'Edit and publish your portfolio'
$s.Save()
Write-Output (Join-Path $desk 'Portfolio CMS.lnk')
`;
const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
console.log(`Shortcut created: ${out.trim()}`);
