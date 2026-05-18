import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatMoveMoneyResponse } from '../formatters.js';
import { currencyToMilliunits, formatUsd, getCurrentBudgetMonth, getYnabErrorMessage, isYnabNotFoundError, milliunitsToCurrency, ynabCurrency } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  month: Type.Optional(Type.String({ description: 'Budget month (YYYY-MM-01). Defaults to current month.' })),
  fromCategory: Type.String({ description: 'Exact source category name.' }),
  toCategory: Type.String({ description: 'Exact destination category name.' }),
  amount: Type.Number({ description: 'Positive USD amount to move.' }),
  dryRun: Type.Optional(Type.Boolean({ description: 'If true, show the move without updating YNAB. Defaults to false.' })),
  allowOverspendSource: Type.Optional(Type.Boolean({ description: 'If true, allow moving more than the source category has available. Defaults to false.' }))
});

function findCategory(categories: ynab.Category[], name: string): ynab.Category | null {
  return categories.find(c => !c.deleted && !c.hidden && c.name === name) ?? null;
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_move_money',
    label: 'Move YNAB Money',
    description: 'Moves money between YNAB categories by adjusting their assigned amounts for a budget month.',
    promptSnippet: 'Move money between two YNAB categories by adjusting assigned amounts.',
    promptGuidelines: [
      'Use ynab_move_money when the user wants to cover overspending or reallocate funds between categories.',
      'Use ynab_move_money with dryRun=true before applying changes unless the user explicitly asks to update YNAB now.',
      'Use ynab_get_categories before ynab_move_money when exact source or destination category names are uncertain.',
      'Do not use ynab_move_money with allowOverspendSource=true unless the user explicitly authorizes overspending the source category.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if (params.fromCategory === params.toCategory) {
        return { content: [{ type: 'text' as const, text: 'Error: fromCategory and toCategory must be different.' }], details: {} };
      }

      const amount = ynabCurrency(params.amount);
      if (amount.value <= 0) {
        return { content: [{ type: 'text' as const, text: 'Error: amount must be greater than 0.' }], details: {} };
      }

      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }], details: {} };
      }

      try {
        const month = params.month ?? getCurrentBudgetMonth();
        const monthResponse = await ynabAPI.months.getPlanMonth(budgetId, month);
        const categories = monthResponse.data.month.categories;
        const fromCategory = findCategory(categories, params.fromCategory);
        const toCategory = findCategory(categories, params.toCategory);

        if (!fromCategory) {
          return { content: [{ type: 'text' as const, text: `Error: Source category "${params.fromCategory}" not found.` }], details: {} };
        }
        if (!toCategory) {
          return { content: [{ type: 'text' as const, text: `Error: Destination category "${params.toCategory}" not found.` }], details: {} };
        }

        const sourceAvailable = milliunitsToCurrency(fromCategory.balance);
        if (!(params.allowOverspendSource ?? false) && sourceAvailable.value < amount.value) {
          return { content: [{ type: 'text' as const, text: `Error: Source category "${fromCategory.name}" only has ${formatUsd(sourceAvailable)} available, less than requested ${formatUsd(amount)}.` }], details: {} };
        }

        const newSourceAssigned = milliunitsToCurrency(fromCategory.budgeted).subtract(amount);
        const newDestinationAssigned = milliunitsToCurrency(toCategory.budgeted).add(amount);
        const dryRun = params.dryRun ?? false;

        if (!dryRun) {
          try {
            await ynabAPI.categories.updateMonthCategory(budgetId, month, fromCategory.id, {
              category: { budgeted: currencyToMilliunits(newSourceAssigned) }
            });
            await ynabAPI.categories.updateMonthCategory(budgetId, month, toCategory.id, {
              category: { budgeted: currencyToMilliunits(newDestinationAssigned) }
            });
          }
          catch (error) {
            return { content: [{ type: 'text' as const, text: `Error: Failed while moving money. This operation uses two YNAB updates and may have partially completed; verify categories in YNAB.\n${getYnabErrorMessage(error)}` }], details: {} };
          }
        }

        return {
          content: [{ type: 'text' as const, text: formatMoveMoneyResponse(fromCategory.name, toCategory.name, month, amount, dryRun) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" or month "${params.month ?? getCurrentBudgetMonth()}" not found.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to move money in YNAB.\n${message}` }], details: {} };
      }
    }
  };
}
