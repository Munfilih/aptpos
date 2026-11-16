'use strict';

const fs = require('fs');
const path = require('path');
const { NtExecutable, NtExecutableResource } = require('pe-library');
const { Data, Resource } = require('resedit');

module.exports = async function patchWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const executablePath = path.join(context.appOutDir, 'aptPOS.exe');
  const iconPath = path.resolve(__dirname, '..', 'build-resources', 'aptpos.ico');
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged executable not found: ${executablePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Windows icon not found: ${iconPath}`);
  }

  const executable = NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const icons = Data.IconFile.from(fs.readFileSync(iconPath)).icons.map(icon => icon.data);

  if (icons.length === 0) {
    throw new Error(`No icons found in ${iconPath}`);
  }

  if (iconGroups.length === 0) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icons);
  } else {
    for (const group of iconGroups) {
      Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
    }
  }

  resources.outputResource(executable);
  fs.writeFileSync(executablePath, Buffer.from(executable.generate()));
};
