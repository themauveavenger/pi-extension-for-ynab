import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import currency from 'currency.js';
import { formatAssignMoneyResponse } from '../formatters.js';
import { currencyToMilliunits, getCurrentBudgetMonth, getYnabErrorMessage, isYnabNotFoundError, milliunitsToCurrency } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  month: Type.Optional(Type.String({ description: 'Budget month (YYYY-MM-01). Defaults to current month.' })),
  category: Type.String({ description: 'Exact category name as it appears in YNAB.' }),
  assignedAmount: Type.Optional(Type.Number({ description: 'Set assigned amount to this USD amount. Mutually exclusive with deltaAmount.' })),
  deltaAmount: Type.Optional(Type.Number({ description: 'Increase/decrease assigned by this USD amount. Mutually exclusive with assignedAmount.' })),
  dryRun: Type.Optional(Type.Boolean({ description: 'If true, show the change without updating YNAB. Defaults to false.' }))
});

function findCategory(categories: ynab.Category[], name: string): ynab.Category | null {
  return categories.find(c => !c.deleted && !c.hidden && c.name === name) ?? null;
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_assign_money',
    label: 'Assign YNAB Money',
    description: 'Sets or adjusts the assigned amount for a YNAB category in a budget month.',
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if ((params.assignedAmount === undefined && params.deltaAmount === undefined)
        || (params.assignedAmount !== undefined && params.deltaAmount !== undefined)) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide exactly one of assignedAmount or deltaAmount.' }], details: {} };
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
        const category = findCategory(monthResponse.data.month.categories, params.category);
        if (!category) {
          return { content: [{ type: 'text' as const, text: `Error: Category "${params.category}" not found. Verify the exact visible category name as it appears in YNAB.` }], details: {} };
        }

        const previousAssigned = milliunitsToCurrency(category.budgeted);
        const newAssigned = params.assignedAmount !== undefined
          ? currency(params.assignedAmount)
          : previousAssigned.add(currency(params.deltaAmount ?? 0));
        const delta = newAssigned.subtract(previousAssigned);
        const dryRun = params.dryRun ?? false;

        if (!dryRun) {
          await ynabAPI.categories.updateMonthCategory(budgetId, month, category.id, {
            category: { budgeted: currencyToMilliunits(newAssigned) }
          });
        }

        return {
          content: [{ type: 'text' as const, text: formatAssignMoneyResponse(category.name, month, previousAssigned, newAssigned, delta, dryRun) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" or month "${params.month ?? getCurrentBudgetMonth()}" not found.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to assign money in YNAB.\n${message}` }], details: {} };
      }
    }
  };
}
