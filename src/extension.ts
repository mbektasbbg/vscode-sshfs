
import * as vscode from 'vscode';
import { loadConfigs } from './config';
import { FileSystemConfig } from './fileSystemConfig';
import { FileSystemRouter } from './fileSystemRouter';
import { Logging } from './logging';
import { Manager } from './manager';

function generateDetail(config: FileSystemConfig): string | undefined {
  const { username, host, putty } = config;
  const port = config.port && config.port !== 22 ? `:${config.port}` : '';
  if (putty) {
    if (typeof putty === 'string') return `PuTTY session "${putty}"`;
    return 'PuTTY session (deduced from config)';
  } else if (!host) {
    return undefined;
  } else if (username) {
    return `${username}@${host}${port}`;
  }
  return `${host}${port}`;
}

async function pickConfig(manager: Manager, activeFileSystem?: boolean): Promise<string | undefined> {
  let fsConfigs = manager.getActiveFileSystems().map(fs => fs.config).map(c => c._calculated || c);
  const others = await loadConfigs();
  if (activeFileSystem === false) {
    fsConfigs = others.filter(c => !fsConfigs.find(cc => cc.name === c.name));
  } else if (activeFileSystem === undefined) {
    others.forEach(n => !fsConfigs.find(c => c.name === n.name) && fsConfigs.push(n));
  }
  const options: (vscode.QuickPickItem & { name: string })[] = fsConfigs.map(config => ({
    name: config.name,
    description: config.name,
    label: config.label || config.name,
    detail: generateDetail(config),
  }));
  const pick = await vscode.window.showQuickPick(options, { placeHolder: 'SSH FS Configuration' });
  return pick && pick.name;
}

function getVersion(): string | undefined {
  const ext = vscode.extensions.getExtension('Kelvin.vscode-sshfs');
  return ext && ext.packageJSON && ext.packageJSON.version;
}

export function activate(context: vscode.ExtensionContext) {
  Logging.info(`Extension activated, version ${getVersion()}`);

  const manager = new Manager(context);

  const subscribe = context.subscriptions.push.bind(context.subscriptions) as typeof context.subscriptions.push;
  const registerCommand = (command: string, callback: (...args: any[]) => any, thisArg?: any) =>
    subscribe(vscode.commands.registerCommand(command, callback, thisArg));

  subscribe(vscode.workspace.registerFileSystemProvider('ssh', new FileSystemRouter(manager), { isCaseSensitive: true }));
  subscribe(vscode.window.createTreeView('sshfs-configs', { treeDataProvider: manager, showCollapseAll: true }));
  subscribe(vscode.tasks.registerTaskProvider('ssh-shell', manager));

  async function pickAndClick(func: (name: string | FileSystemConfig) => void, name?: string | FileSystemConfig, activeOrNot?: boolean) {
    name = name || await pickConfig(manager, activeOrNot);
    if (name) func.call(manager, name);
  }

  registerCommand('sshfs.new', () => manager.openSettings({ type: 'newconfig' }));
  registerCommand('sshfs.settings', () => manager.openSettings());

  registerCommand('sshfs.connect', (name?: string | FileSystemConfig) => pickAndClick(manager.commandConnect, name, false));
  registerCommand('sshfs.disconnect', (name?: string | FileSystemConfig) => pickAndClick(manager.commandDisconnect, name, true));
  registerCommand('sshfs.reconnect', (name?: string | FileSystemConfig) => pickAndClick(manager.commandReconnect, name, true));
  registerCommand('sshfs.terminal', async (configOrUri?: string | FileSystemConfig | vscode.Uri) => {
    // SSH FS view context menu: [ config, null ]
    // Explorer context menu: [ uri, [uri] ]
    // Command: [ ]
    // And just in case, supporting [ configName ] too
    let config = configOrUri;
    let uri: vscode.Uri | undefined;
    if (config instanceof vscode.Uri) {
      uri = config;
      config = config.authority;
    }
    config = config || await pickConfig(manager);
    if (config) manager.commandTerminal(config, uri);
  });
  registerCommand('sshfs.configure', (name?: string | FileSystemConfig) => pickAndClick(manager.commandConfigure, name));

  registerCommand('sshfs.reload', loadConfigs);
}
