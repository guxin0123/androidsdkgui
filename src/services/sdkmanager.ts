import { copy, readdir, remove } from 'fs-extra';
import * as Path from 'path';

import { AppSetting } from '../models/models';
import { execFileAsync, Standard } from './execpromise';

const isWindows = process.platform === 'win32';

/**
 * check agree android sdk license
 * @param sdkSetting SDK Setting values
 */
export async function checkLicenseAsync(sdkSetting: AppSetting): Promise<boolean> {
  const licensePath = Path.join(sdkSetting.sdkRootPath, 'licenses');
  // read license files
  const files = await readdir(licensePath).catch(e => [] as string[]);
  // at least android sdk license exists
  return files.findIndex(file => /^android-sdk-license$/.test(file)) >= 0;
}

/**
 * exec `sdkmanager --list`
 * @param sdkSetting SDK Setting values
 */
export async function getListAsync(sdkSetting: AppSetting): Promise<Standard> {
  return await execSdkManagerAsync(sdkSetting, ['--list']);
}

/**
 * check done sdkmanager.
 */
export async function checkDoneAsync(sdkSetting: AppSetting): Promise<boolean> {
  const std = await getListAsync(sdkSetting);
  return parseList(std.out).length >= 1;
}

/**
 * parse sdkmanager get list
 */
export function parseList(stdout: string) {
  const packages: Package[] = [];

  const lines = stdout.split(/\r?\n/);
  let pointer = 0;

  // skip
  for (; pointer < lines.length; pointer += 1) {
    if (lines[pointer].endsWith('Installed packages:')) {
      pointer += 3;
      break;
    }
  }

  // installed packages
  for (; pointer < lines.length; pointer += 1) {
    // skip blank
    if (lines[pointer] === '') {
      pointer += 1;
    }
    if (lines[pointer].startsWith('Available Packages:')) {
      pointer += 3;
      break;
    }

    // split line (Path|Version|Description|Location)
    const elements = lines[pointer].split('| ').map(e => e.trim());

    // set
    const p = new Package();
    p.state = InstallStates.Installed;
    p.rawName = elements[0];
    [p.name, p.category] = parsePackageName(p.rawName);
    p.version = elements[1];
    p.description = elements[2];

    packages.push(p);
  }

  // available packages
  for (; pointer < lines.length; pointer += 1) {
    // skip blank
    if (lines[pointer] === '') {
      pointer += 1;
      continue;
    }
    if (lines[pointer].startsWith('Available Updates:')) {
      pointer += 3;
      break;
    }

    // split line (Path|Version|Description)
    const elements = lines[pointer].split('| ').map(e => e.trim());

    const index = packages.findIndex(pkg => pkg.rawName === elements[0]);
    if (index === -1) {
      // Not installed
      const p = new Package();
      p.state = InstallStates.Available;
      p.rawName = elements[0];
      [p.name, p.category] = parsePackageName(p.rawName);
      p.version = elements[1];
      p.description = elements[2];

      packages.push(p);
    } else {
      // Already installed
      const p = packages[index];
      const rv = elements[1];
      if (cmpVersions(p.version, rv) < 0) {
          p.state = InstallStates.Updateable;
          p.version = p.version + '(' + rv + ')';
      }
    }
  }

  return packages;
}

/**
 * sorting packages by name
 * @param packages packages
 * @param order 'asc' | 'desc' (default: 'desc')
 */
export function sort(packages: Package[], order: String = 'desc'): Package[] {
  return packages.sort((a, b) => {
    const nameA = a.rawName.toLowerCase();
    const nameB = b.rawName.toLowerCase();

    return (nameA < nameB ? -1 : 1) * (order === 'asc' ? 1 : -1);
  });
}

/**
 * exec `sdkmanager --install [package]`
 * @param sdkSetting SDK setting value
 * @param packageRawName package name
 */
export async function installPackageAsync(sdkSetting: AppSetting, packageRawName: string) {
  // before copy tools directory
  const tempDir = Path.join(sdkSetting.sdkRootPath, 'temp');
  await copy(Path.join(sdkSetting.sdkRootPath, 'tools'), tempDir);
  // install
  await execSdkManagerAsync(sdkSetting, [`${packageRawName}`], true);

  // remove temp dir
  await remove(tempDir);
}

export function getSdkManagerPath(sdkSetting: AppSetting, useTmpToolsDir?: boolean) {
  let file = Path.join(sdkSetting.sdkRootPath, useTmpToolsDir ? 'temp' : 'tools' , 'bin', 'sdkmanager');
  if (isWindows) {
    file += '.bat';
  }
  return file;
}

/**
 * execute for `sdkmanager`
 * @param sdkSetting SDK setting value
 * @param args sdkmanager arguments
 */
async function execSdkManagerAsync(sdkSetting: AppSetting, args: string[], useTmpToolsDir?: boolean) {
  const file = getSdkManagerPath(sdkSetting, useTmpToolsDir);

  const commonArgs = [`--sdk_root=${sdkSetting.sdkRootPath}`];
  if (sdkSetting.useProxy) {
    commonArgs.push('--proxy=http');
    commonArgs.push(`--proxy_host=${sdkSetting.proxy}`);
    commonArgs.push(`--proxy_port=${sdkSetting.port}`);
  }

  console.log(`exec: ${file} ${commonArgs.concat(args).join(' ')}`);
  const std = await execFileAsync(file, commonArgs.concat(args));
  console.log(std.out);
  console.warn(std.err);

  return std;
}

function parsePackageName(name: string): [string, string] {
  const names = name.split(';');
  return [names[1] ? names.slice(1).join('; ') : names[0], names[0]];
}

// https://stackoverflow.com/a/16187766
function cmpVersions (a: string, b: string) {
    const regExStrip0 = /(\.0+)+$/;
    const segmentsA = a.replace(regExStrip0, '').split('.');
    const segmentsB = b.replace(regExStrip0, '').split('.');
    const l = Math.min(segmentsA.length, segmentsB.length);

    for (let i = 0; i < l; i++) {
        const diff = parseInt(segmentsA[i], 10) - parseInt(segmentsB[i], 10);
        if (diff) {
            return diff;
        }
    }
    return segmentsA.length - segmentsB.length;
}

export class Package {
  category: string;
  name: string;
  rawName: string;
  details: string[] | null;
  description: string;
  version: string;
  state: InstallStates;
}

export enum InstallStates {
  Installed = 'Installed',
  Available = 'Available',
  Updateable = 'Updateable'
}
