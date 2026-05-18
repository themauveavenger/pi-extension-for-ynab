import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatAccountsResponse } from '../formatters.js';
import { getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  includeClosed: Type.Optional(Type.Boolean({ description: 'If true, include closed accounts. Defaults to false.' })),
  includeOffBudget: Type.Optional(Type.Boolean({ description: 'If true, include off-budget/tracking accounts. Defaults to false.' })),
  includeDeleted: Type.Optional(Type.Boolean({ description: 'If true, include deleted accounts. Defaults to false.' })),
  verbose: Type.Optional(Type.Boolean({ description: 'If true, include direct import and reconciliation details. Defaults to false.' }))
});

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_get_accounts',
    label: 'Get YNAB Accounts',
    description: 'Fetches YNAB account balances, including cleared and uncleared balances. Defaults to open on-budget accounts.',
    promptSnippet: 'List YNAB accounts, balances, cleared balances, uncleared balances, and optional import details.',
    promptGuidelines: [
      'Use ynab_get_accounts to discover exact account names before creating transactions or transfers.',
      'Use ynab_get_accounts with includeClosed or includeOffBudget only when the user asks for closed, tracking, or off-budget accounts.',
      'Use ynab_get_accounts with verbose=true when direct import or reconciliation status matters.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }], details: {} };
      }

      try {
        const response = await ynabAPI.accounts.getAccounts(budgetId);
        let accounts = response.data.accounts;

        if (!(params.includeDeleted ?? false)) accounts = accounts.filter(a => !a.deleted);
        if (!(params.includeClosed ?? false)) accounts = accounts.filter(a => !a.closed);
        if (!(params.includeOffBudget ?? false)) accounts = accounts.filter(a => a.on_budget);

        accounts = [...accounts].sort((a, b) => {
          if (a.on_budget !== b.on_budget) return a.on_budget ? -1 : 1;
          if (a.closed !== b.closed) return a.closed ? 1 : -1;
          return a.name.localeCompare(b.name);
        });

        return {
          content: [{ type: 'text' as const, text: formatAccountsResponse(budgetId, accounts, response.data.accounts.length, params.verbose ?? false) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to fetch YNAB accounts.\n${message}` }], details: {} };
      }
    }
  };
}
