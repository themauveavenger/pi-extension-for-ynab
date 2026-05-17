import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface YnabExtensionConfig {
  budgetId?: string;
}

export interface YnabBudgetResolverOptions {
  defaultBudgetId?: string;
  configPath?: string;
}

function isConfig(value: unknown): value is YnabExtensionConfig {
  return (
    typeof value === 'object'
    && value !== null
    && (!('budgetId' in value) || typeof (value as { budgetId?: unknown }).budgetId === 'string')
  );
}

export function loadYnabExtensionConfig(configPath?: string): YnabExtensionConfig {
  const paths = configPath
    ? [resolve(configPath)]
    : [
        resolve('.ynab-extension.json'),
        resolve(homedir(), '.config/pi-extension-for-ynab/config.json'),
        resolve(homedir(), '.pi/agent/extensions/pi-extension-for-ynab/config.json')
      ];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isConfig(parsed)) {
      throw new Error(`Invalid YNAB extension config at ${path}. Expected { "budgetId": "..." }.`);
    }
    return parsed;
  }

  return {};
}

export function createBudgetIdResolver(options: YnabBudgetResolverOptions = {}) {
  const config = loadYnabExtensionConfig(options.configPath);

  return (budgetId?: string): string => {
    const resolvedBudgetId = budgetId
      ?? options.defaultBudgetId
      ?? process.env.YNAB_BUDGET_ID
      ?? config.budgetId;

    if (!resolvedBudgetId) {
      throw new Error('No YNAB budget ID provided. Pass budgetId, set YNAB_BUDGET_ID, or configure budgetId in .ynab-extension.json.');
    }

    return resolvedBudgetId;
  };
}
