import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type * as ynab from 'ynab';
import ynabGetTransactionsTool from './tools/ynab-get-transactions.js';
import ynabGetPayeeHistoryTool from './tools/ynab-get-payee-history.js';
import ynabCreateTransactionTool from './tools/ynab-create-transaction.js';
import ynabSplitTransactionTool from './tools/ynab-split-transaction.js';
import ynabApproveTransactionTool from './tools/ynab-approve-transaction.js';
import ynabDeleteTransactionTool from './tools/ynab-delete-transaction.js';
import ynabFlagTransactionTool from './tools/ynab-flag-transaction.js';
import ynabGetBudgetMonthTool from './tools/ynab-get-budget-month.js';
import ynabGetCategoriesTool from './tools/ynab-get-categories.js';
import ynabGetAccountsTool from './tools/ynab-get-accounts.js';
import ynabAssignMoneyTool from './tools/ynab-assign-money.js';
import ynabMoveMoneyTool from './tools/ynab-move-money.js';
import ynabUpdateCategoryGoalTool from './tools/ynab-update-category-goal.js';
import ynabPayeesListTool from './tools/ynab-payees-list.js';
import { createBudgetIdResolver } from './config.js';
import { YnabClient, createYnabClientFromEnv } from './ynab-client.js';

export interface YnabExtensionOptions {
  accessToken?: string;
  ynabClient?: YnabClient;
  ynabAPI?: ynab.API;
  defaultBudgetId?: string;
  configPath?: string;
}

function resolveYnabAPI(options: YnabExtensionOptions = {}): ynab.API {
  if (options.ynabAPI) return options.ynabAPI;
  if (options.ynabClient) return options.ynabClient.api;
  if (options.accessToken) return new YnabClient(options.accessToken).api;
  return createYnabClientFromEnv().api;
}

export function createYnabExtension(options: YnabExtensionOptions = {}) {
  return (pi: ExtensionAPI): void => {
    const ynabAPI = resolveYnabAPI(options);
    const resolveBudgetId = createBudgetIdResolver({
      defaultBudgetId: options.defaultBudgetId,
      configPath: options.configPath
    });

    pi.registerTool(ynabGetTransactionsTool(ynabAPI));
    pi.registerTool(ynabGetPayeeHistoryTool(ynabAPI));
    pi.registerTool(ynabCreateTransactionTool(ynabAPI));
    pi.registerTool(ynabSplitTransactionTool(ynabAPI));
    pi.registerTool(ynabApproveTransactionTool(ynabAPI));
    pi.registerTool(ynabDeleteTransactionTool(ynabAPI));
    pi.registerTool(ynabFlagTransactionTool(ynabAPI));
    pi.registerTool(ynabGetBudgetMonthTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabGetCategoriesTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabGetAccountsTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabAssignMoneyTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabMoveMoneyTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabUpdateCategoryGoalTool(ynabAPI, resolveBudgetId));
    pi.registerTool(ynabPayeesListTool(ynabAPI, resolveBudgetId));
  };
}

export default function ynabExtension(pi: ExtensionAPI): void {
  return createYnabExtension()(pi);
}

export { YnabClient, createYnabClientFromEnv };
